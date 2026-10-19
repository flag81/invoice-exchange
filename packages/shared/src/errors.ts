/**
 * The single exception type the domain core throws.
 *
 * `packages/shared` never throws a bare `Error`: a caller that catches a `DomainError` knows the
 * failure was a *rule* — an amount that cannot be parsed, a transition the table does not contain —
 * rather than a bug in the plumbing. Codes are a closed union of strings (`as const`), not an `enum`,
 * which keeps them usable as plain values across the wire and in the future React Native client.
 *
 * Mapping these codes onto the HTTP envelope (`§6`) is deliberately *not* done here: a status code is
 * a transport concern, so the map lives in `apps/web` (phase 3). The domain only names the rule.
 */
export const DomainErrorCode = {
  /** An amount string is not an integer number of minor units for its currency. */
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  /** A quantity is not a plain decimal with at most the allowed scale (or is negative). */
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  /** A tax rate is not a plain decimal percentage within `0..100`. */
  INVALID_RATE: 'INVALID_RATE',
  /** A currency code outside the closed ISO 4217 set this build knows about. */
  UNKNOWN_CURRENCY: 'UNKNOWN_CURRENCY',
  /** A totals snapshot does not satisfy `subtotal + tax − discount = total` and friends. */
  TOTALS_MISMATCH: 'TOTALS_MISMATCH',
  /** An invoice violates a structural invariant (same company on both sides, missing number, …). */
  INVALID_INVOICE: 'INVALID_INVOICE',
  /** The same supplier's invoice number is already stored for this company (`invoicing/duplicates`). */
  DUPLICATE_INVOICE: 'DUPLICATE_INVOICE',
  /** An invoice party row is malformed (unknown role, missing name, self-reference). */
  INVALID_PARTY: 'INVALID_PARTY',
  /** The requested transition is not in the table for the current state, actor or payload. */
  STATE_CONFLICT: 'STATE_CONFLICT',
  /** A transition requires a reason (`DISPUTED`) and none was supplied. */
  REASON_REQUIRED: 'REASON_REQUIRED',
  /** The acting roles do not hold the permission the use-case requires. */
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  /** Integer division by zero — a programming error, but a named one. */
  DIVISION_BY_ZERO: 'DIVISION_BY_ZERO',
} as const;

export type DomainErrorCode = (typeof DomainErrorCode)[keyof typeof DomainErrorCode];

/**
 * Structured, log-safe context. Primitive only on purpose: these values end up in logs and in the
 * `details` of an HTTP 4xx, so they must never be an entity, a request or a class instance.
 */
export type DomainErrorDetails = Readonly<
  Record<string, string | number | bigint | boolean | null>
>;

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  readonly details: DomainErrorDetails | undefined;

  constructor(code: DomainErrorCode, message: string, details?: DomainErrorDetails) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

/** Narrows an `unknown` catch variable to a domain failure without an assertion. */
export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

/**
 * Throws a `DomainError`. Declared `never` so it can stand in for a missing `return` in an
 * exhaustive switch — the compiler then proves the branches are covered.
 */
export function fail(code: DomainErrorCode, message: string, details?: DomainErrorDetails): never {
  throw new DomainError(code, message, details);
}
