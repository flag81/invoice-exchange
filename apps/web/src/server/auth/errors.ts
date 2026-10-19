/**
 * The four ways an authentication step can fail, as a type rather than a string.
 *
 * Auth failures are *not* `DomainError`s: the domain package knows about invoices, not about browsers.
 * They are also not all 4xx — a missing `GOOGLE_CLIENT_ID` is a deployment problem (503), while a
 * reused `state` is a suspicious request (400). Naming them here lets `toErrorResponse` map each to the
 * status it deserves, and lets the callback redirect to `/signin?error=…` with a code the page can
 * translate instead of leaking provider prose.
 */

export const AuthErrorCode = {
  /** No session (or a dead one): the caller must sign in. 401, or a redirect to `/signin`. */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** A cookie-authenticated request whose `Origin` is not this site. 403. */
  CROSS_ORIGIN: 'CROSS_ORIGIN',
  /** Google sign-in is not configured in this environment. 503, with the missing keys named. */
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  /** The round trip failed: bad `state`, replayed state, missing code, or a refused exchange. 400/502. */
  OAUTH_FAILED: 'OAUTH_FAILED',
  /** Google said the email is not verified, so it cannot identify (or link to) an account. 403. */
  EMAIL_UNVERIFIED: 'EMAIL_UNVERIFIED',
} as const;

export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  /** For logs only: never rendered into a page or a redirect query string. */
  readonly detail: string | undefined;

  constructor(code: AuthErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.detail = detail;
  }
}

export function isAuthError(value: unknown): value is AuthError {
  return value instanceof AuthError;
}
