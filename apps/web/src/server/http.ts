/**
 * The HTTP envelope: one shape for every error a route can produce, and one place that decides which
 * status a domain failure deserves (`docs/architecture.md` §6).
 *
 * The mapping is the part that matters. A `DomainError` is a *rule* the caller broke, so it is a 4xx
 * with the code in the body — the mobile client can branch on `STATE_CONFLICT` without parsing prose.
 * A `DatabaseUnavailableError` is an outage, so it is a 503 with advice. Anything else is a 500 whose
 * body says nothing: stack traces belong in logs, not in responses.
 */

import { DatabaseUnavailableError } from '@einv/db';
import { isDomainError, type DomainErrorCode, type DomainErrorDetails } from '@einv/shared';

import { sq } from '@/lib/copy/sq';
import { AuthError, AuthErrorCode } from '@/server/auth/errors';
import { ExtractionFailedError } from '@/server/extraction/types';
import { UnsafeStorageKeyError } from '@/server/storage/local-storage';

/** Domain failures that mean "what you sent is not acceptable", and the status each deserves. */
const DOMAIN_STATUS: Readonly<Record<DomainErrorCode, number>> = {
  INVALID_AMOUNT: 422,
  INVALID_QUANTITY: 422,
  INVALID_RATE: 422,
  UNKNOWN_CURRENCY: 422,
  TOTALS_MISMATCH: 409,
  INVALID_INVOICE: 422,
  DUPLICATE_INVOICE: 409,
  INVALID_PARTY: 422,
  STATE_CONFLICT: 409,
  REASON_REQUIRED: 422,
  PERMISSION_DENIED: 403,
  DIVISION_BY_ZERO: 500,
};

export type ErrorBody = {
  readonly error: {
    readonly code: string;
    /** Safe to show a user: never a stack trace, never a credential, never an internal path. */
    readonly message: string;
    readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  };
};

/**
 * Auth failures, by the status each deserves.
 *
 * `NOT_CONFIGURED` is a 503 rather than a 500 because it is a deployment fact, not a bug: the operator
 * can fix it by setting two variables. `OAUTH_FAILED` is a 400 — the round trip the browser carried came
 * back wrong — and `EMAIL_UNVERIFIED` a 403, because the request was understood and refused.
 */
const AUTH_STATUS: Readonly<Record<AuthErrorCode, number>> = {
  [AuthErrorCode.UNAUTHENTICATED]: 401,
  [AuthErrorCode.CROSS_ORIGIN]: 403,
  [AuthErrorCode.NOT_CONFIGURED]: 503,
  [AuthErrorCode.OAUTH_FAILED]: 400,
  [AuthErrorCode.EMAIL_UNVERIFIED]: 403,
};

function body(code: string, message: string, details?: ErrorBody['error']['details']): ErrorBody {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}

/**
 * JSON has no `bigint`, so an amount inside a domain error's details would throw when the response is
 * serialised. Converting it to a decimal string here (rather than dropping it) keeps the diagnostic
 * value: `{"amount":"1234"}` says as much as `1234n` to whoever reads the 422.
 */
function safeDetails(
  details: DomainErrorDetails | undefined,
): Readonly<Record<string, string | number | boolean | null>> | undefined {
  if (details === undefined) {
    return undefined;
  }

  const safe: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(details)) {
    safe[key] = typeof value === 'bigint' ? value.toString() : value;
  }

  return safe;
}

/** Maps any thrown value to a `Response`. Used by every route handler in the capture flow. */
export function toErrorResponse(error: unknown): Response {
  if (isDomainError(error)) {
    return Response.json(body(error.code, error.message, safeDetails(error.details)), {
      status: DOMAIN_STATUS[error.code],
      headers: { 'cache-control': 'no-store' },
    });
  }

  if (error instanceof DatabaseUnavailableError) {
    return Response.json(body(error.code, error.message), {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  }

  if (error instanceof AuthError) {
    return Response.json(body(error.code, error.message), {
      status: AUTH_STATUS[error.code],
      headers: { 'cache-control': 'no-store' },
    });
  }

  if (error instanceof ExtractionFailedError) {
    return Response.json(body(error.code, error.message), {
      status: 502,
      headers: { 'cache-control': 'no-store' },
    });
  }

  if (error instanceof UnsafeStorageKeyError) {
    return Response.json(body(error.code, error.message), {
      status: 400,
      headers: { 'cache-control': 'no-store' },
    });
  }

  // The response stays opaque, but a 500 is always a bug: without this line the stack is gone and
  // nobody can tell a broken request from a broken deployment.
  console.error('[api] unhandled error', error);

  return Response.json(body('INTERNAL_ERROR', sq.api.internal), {
    status: 500,
    headers: { 'cache-control': 'no-store' },
  });
}

/** JSON with the headers this API always sets: never cached, always typed. */
export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Reads a JSON body, treating an empty or malformed one as `null` rather than throwing. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** An object with unknown values — the shape every untrusted body has before it is validated. */
export function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Readonly<Record<string, unknown>>;
}

/** A trimmed, non-empty string field, or `null`. Numbers are accepted, because forms send both. */
export function readStringField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = record[key];

  if (typeof value === 'string') {
    const trimmed = value.trim();

    return trimmed === '' ? null : trimmed;
  }

  return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}

/** One of a closed set of strings, or the fallback — used for `captureSource` and friends. */
export function readEnumField<T extends string>(
  record: Readonly<Record<string, unknown>>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = readStringField(record, key);

  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
