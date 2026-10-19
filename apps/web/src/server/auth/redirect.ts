/**
 * Redirects, as the OAuth routes use them.
 *
 * Both routes end in a `Location` header: the start route sends the browser to Google, the callback sends
 * it back into the app. Neither can return JSON — a person is watching — so errors are expressed as a
 * *code* on `/signin`, which turns it into an Albanian sentence.
 *
 * The one thing every failure shares: the OAuth attempt cookie is deleted. An attempt that ended badly
 * must not be resumable by pressing "back" and resubmitting.
 */

import { DatabaseUnavailableError } from '@einv/db';
import { DomainErrorCode, isDomainError } from '@einv/shared';

import { AuthError, AuthErrorCode } from './errors';
import { OAUTH_COOKIE, expiredCookie, serialiseCookie, type CookieAttributes } from './cookies';
import { DEFAULT_RETURN_TO, signInErrorPath } from './return-to';

/** The `oauth_accounts.provider` value for Google. Stored as a string, so it is named once. */
export const GOOGLE_PROVIDER = 'google';

/** A `303` with any number of cookies. See `Set-Cookie`, which may repeat in one response. */
export function redirectResponse(
  location: string,
  cookies: readonly CookieAttributes[] = [],
): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });

  for (const cookie of cookies) {
    headers.append('set-cookie', serialiseCookie(cookie));
  }

  return new Response(null, { status: 303, headers });
}

/**
 * The code `/signin` will show. Provider prose never reaches it.
 *
 * `PERMISSION_DENIED` from the domain is the "this email belongs to an account, but Google would not
 * verify it" rule (`signInWithOAuth`); it reaches the page as `EMAIL_UNVERIFIED`, which is the sentence a
 * person can act on.
 */
export function authErrorCodeOf(error: unknown): string {
  if (error instanceof AuthError) {
    return error.code;
  }

  if (isDomainError(error) && error.code === DomainErrorCode.PERMISSION_DENIED) {
    return AuthErrorCode.EMAIL_UNVERIFIED;
  }

  if (error instanceof DatabaseUnavailableError) {
    return 'DATABASE_UNAVAILABLE';
  }

  // A bug, not a refusal: log it (the redirect body cannot carry it) and tell the person something true.
  console.error('[auth] sign-in failed', error);

  return AuthErrorCode.OAUTH_FAILED;
}

/** Where a failed attempt lands. */
export function redirectToSignIn(error: unknown, returnTo: string = DEFAULT_RETURN_TO): Response {
  return redirectResponse(signInErrorPath(authErrorCodeOf(error), returnTo), [
    expiredCookie(OAUTH_COOKIE),
  ]);
}
