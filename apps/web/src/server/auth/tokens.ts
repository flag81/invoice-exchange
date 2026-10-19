/**
 * The two secrets of a sign-in, and the only place that decides how they are made and compared.
 *
 * Both are 256 bits from `crypto.randomBytes`, encoded base64url so they survive a cookie and a query
 * string unchanged. The session token is *never* stored: the database keeps `sha256(token)` and this
 * module is the single definition of that hash, so creating and looking up a session cannot disagree.
 *
 * The lifetimes are constants rather than environment variables on purpose — a session that lives 30
 * days and an OAuth attempt that lives 10 minutes are policy, and policy that can be changed by a
 * `.env` edit is policy nobody reviewed.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** How long a signed-in browser stays signed in (absolute; there is no sliding renewal). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** How long an unfinished OAuth attempt is allowed to take. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** A URL-safe random value: 32 bytes of entropy rendered as 43 characters. */
export function randomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

/** Hex SHA-256, the form the `sessions.token_hash` column stores. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * A comparison that does not leak where two strings differ.
 *
 * `state` and `code_verifier` are secrets that arrive back from the browser, so `a === b` would be a
 * (small, but free to avoid) timing oracle. Length is compared first because `timingSafeEqual` throws
 * on different lengths.
 */
export function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');

  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
