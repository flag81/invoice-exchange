/**
 * The session, resolved into the one value the rest of the app is allowed to ask for: an `Actor`.
 *
 * An `Actor` is a user *and* the tenant they are acting for, because every query in this codebase takes a
 * `companyId` and none of them may take it from the request. Routes call `requireActor(request)`; pages
 * call `currentActor()` through `requirePageActor`.
 *
 * Three properties worth stating, because they are easy to lose later:
 *
 *   * the cookie is looked up by hash — the token itself never appears in a log line or a query;
 *   * the role and the company are re-read from the database on **every** request, so a removed
 *     membership or a deleted company ends the session immediately, not at the next deploy;
 *   * `lastSeenAt` is refreshed at most once every five minutes, so a page that makes four API calls is
 *     one write, not five.
 */

import {
  createSession,
  findActiveSession,
  loadTenant,
  revokeSessionByTokenHash,
  touchSession,
} from '@einv/db';
import type { Role } from '@einv/shared';
import type { SignedInIdentity, Tenant } from '@einv/db';
import { cookies } from 'next/headers';

import { sq } from '@/lib/copy/sq';
import { serverEnv } from '@/lib/env';

import {
  expiredCookie,
  readCookie,
  sessionCookie,
  sessionCookieName,
  type CookieAttributes,
} from './cookies';
import { AuthError, AuthErrorCode } from './errors';
import { assertSameOrigin } from './origin';
import { randomToken, sha256Hex, SESSION_TTL_MS } from './tokens';

/** How stale `last_seen_at` may get before a request pays for an update. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type Actor = {
  readonly sessionId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string | null;
  readonly imageUrl: string | null;
  readonly role: Role;
  /** Everything a tenant-scoped query needs: company id, currency, VAT table. */
  readonly tenant: Tenant;
  readonly expiresAt: Date;
};

/** A request's IP, as recorded for the audit trail. First `x-forwarded-for` hop, truncated. */
export function clientIpAddress(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');

  if (forwarded === null) {
    return request.headers.get('x-real-ip')?.slice(0, 64) ?? null;
  }

  const first = forwarded.split(',')[0]?.trim();

  return first === undefined || first === '' ? null : first.slice(0, 64);
}

function userAgentOf(request: Request): string | null {
  const agent = request.headers.get('user-agent');

  return agent === null || agent === '' ? null : agent.slice(0, 512);
}

/**
 * The actor behind a token, or `null`.
 *
 * `null` covers every dead-session case at once (unknown, revoked, expired, company deleted, membership
 * removed), which is what makes the callers simple: all of them mean "sign in again".
 */
async function actorFromToken(token: string, now: Date): Promise<Actor | null> {
  const session = await findActiveSession(sha256Hex(token), now);

  if (session === null) {
    return null;
  }

  const tenant = await loadTenant(session.companyId);

  if (tenant === null) {
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    // A failed touch must not fail the request it was decorating: the session is still valid, and the
    // next request will try again. (If the database is down, the reads above already failed.)
    await touchSession(session.sessionId, now).catch(() => undefined);
  }

  return {
    sessionId: session.sessionId,
    userId: session.userId,
    email: session.email,
    name: session.name,
    imageUrl: session.imageUrl,
    role: session.role,
    tenant,
    expiresAt: session.expiresAt,
  };
}

/**
 * The actor for an API request: the session cookie, resolved, with the CSRF gate applied first.
 *
 * Throws `AuthError` — `CROSS_ORIGIN` (403) or `UNAUTHENTICATED` (401) — which `toErrorResponse` maps.
 * The same-origin check runs before the database so a forged request costs nothing.
 */
export async function requireActor(request: Request, now = new Date()): Promise<Actor> {
  assertSameOrigin(request, serverEnv().APP_URL);

  const token = readCookie(request.headers.get('cookie'), sessionCookieName());

  if (token === null) {
    throw new AuthError(AuthErrorCode.UNAUTHENTICATED, sq.api.unauthenticated);
  }

  const actor = await actorFromToken(token, now);

  if (actor === null) {
    throw new AuthError(AuthErrorCode.UNAUTHENTICATED, sq.api.unauthenticated);
  }

  return actor;
}

/**
 * The actor for a server component, read from the request's cookies.
 *
 * Separate from `requireActor` only because a page has no `Request`: `cookies()` is the same data. It does
 * not enforce the same-origin rule — a page render is a `GET`.
 */
export async function currentActor(now = new Date()): Promise<Actor | null> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;

  return token === undefined ? null : actorFromToken(token, now);
}

/** Whether Google sign-in is configured — the sign-in page asks before rendering a dead button. */
export function signInIsConfigured(): boolean {
  const env = serverEnv();

  return env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined;
}

/**
 * Creates the session row and the cookie that names it.
 *
 * The token is generated here and hashed here; nothing above this function ever sees the hash, and nothing
 * below it ever sees the token.
 */
export async function startSession(
  identity: SignedInIdentity,
  request: Request,
  now = new Date(),
): Promise<{ readonly cookie: CookieAttributes; readonly expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await createSession({
    userId: identity.userId,
    tokenHash: sha256Hex(token),
    companyId: identity.companyId,
    expiresAt,
    ipAddress: clientIpAddress(request),
    userAgent: userAgentOf(request),
  });

  return { cookie: sessionCookie(token, expiresAt, now), expiresAt };
}

/**
 * Revokes the session (if any) and returns the cookie that clears the browser's copy.
 *
 * Signing out when there is no session is a success: the caller's intent — "I am not signed in" — is
 * already true, and an error page for it would be noise.
 */
export async function endSession(request: Request, now = new Date()): Promise<CookieAttributes> {
  const token = readCookie(request.headers.get('cookie'), sessionCookieName());

  if (token !== null) {
    await revokeSessionByTokenHash(sha256Hex(token), now);
  }

  return expiredCookie(sessionCookieName());
}
