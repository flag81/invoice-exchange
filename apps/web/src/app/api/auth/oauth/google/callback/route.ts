import { consumeOAuthState, signInWithOAuth } from '@einv/db';

import { readCookie, OAUTH_COOKIE, expiredCookie, parseOAuthCookie } from '@/server/auth/cookies';
import { AuthError, AuthErrorCode } from '@/server/auth/errors';
import { exchangeGoogleCode, requireGoogleConfig } from '@/server/auth/providers/google';
import { GOOGLE_PROVIDER, redirectResponse, redirectToSignIn } from '@/server/auth/redirect';
import { DEFAULT_RETURN_TO, safeReturnTo } from '@/server/auth/return-to';
import { startSession } from '@/server/auth/session';
import { constantTimeEquals } from '@/server/auth/tokens';

/**
 * `GET /api/auth/oauth/google/callback` — the second half, and the only place a session is created.
 *
 * The order of the checks is the design:
 *
 *   1. **Google may have said no.** `?error=access_denied` is a person pressing "cancel" on the consent
 *      screen, which is not a bug and must not read like one.
 *   2. **The cookie must match the `state`.** This is what stops a callback produced for *another*
 *      browser from completing here (login CSRF): an attacker who obtains a valid code cannot make the
 *      victim's browser carry *their* session, because the victim never started an attempt with that
 *      state.
 *   3. **The row must still be unused.** `consumeOAuthState` is one conditional `UPDATE`, so a replayed
 *      callback — even one with both cookies — finds nothing the second time.
 *   4. **The code is exchanged with the PKCE verifier from the row**, and the ID token is verified
 *      (`aud`, `iss`, `exp`, `nonce`, `email_verified`) before anything is written.
 *   5. **Only then**: link the account, make sure the person has a company, and issue the session.
 *
 * The response is a `303` that carries two cookies (the session, and the deletion of the attempt) and
 * lands on the path the person originally asked for.
 */
export const dynamic = 'force-dynamic';

function callbackFailure(code: AuthErrorCode, detail: string): AuthError {
  return new AuthError(code, 'hyrja me Google nuk përfundoi; provo përsëri', detail);
}

export async function GET(request: Request): Promise<Response> {
  let returnTo: string = DEFAULT_RETURN_TO;

  try {
    const config = requireGoogleConfig();
    const url = new URL(request.url);
    const params = url.searchParams;
    const now = new Date();

    const attempt = parseOAuthCookie(readCookie(request.headers.get('cookie'), OAUTH_COOKIE));
    const state = params.get('state');

    if (attempt === null || state === null || !constantTimeEquals(attempt.state, state)) {
      throw callbackFailure(
        AuthErrorCode.OAUTH_FAILED,
        params.get('error') ?? 'missing or mismatched state',
      );
    }

    const consumed = await consumeOAuthState({ provider: GOOGLE_PROVIDER, state, now });

    if (consumed === null) {
      throw callbackFailure(AuthErrorCode.OAUTH_FAILED, 'state was already used or expired');
    }

    returnTo = safeReturnTo(consumed.returnTo);

    if (params.get('error') !== null) {
      // Consent refused, or the provider refused the client. Either way this attempt is over.
      throw callbackFailure(AuthErrorCode.OAUTH_FAILED, params.get('error') ?? 'provider error');
    }

    const code = params.get('code');

    if (code === null || code === '') {
      throw callbackFailure(AuthErrorCode.OAUTH_FAILED, 'callback has no code');
    }

    if (consumed.nonce === null) {
      throw callbackFailure(AuthErrorCode.OAUTH_FAILED, 'stored attempt has no nonce');
    }

    const profile = await exchangeGoogleCode(
      { config },
      { code, codeVerifier: consumed.codeVerifier, nonce: consumed.nonce, now },
    );

    const identity = await signInWithOAuth(profile);
    const session = await startSession(identity, request, now);

    // Two cookies, one trip: the session the person just earned, and the deletion of the attempt that
    // earned it. `SameSite=Lax` on both means neither is needed on the jump *to* Google.
    return redirectResponse(returnTo, [session.cookie, expiredCookie(OAUTH_COOKIE)]);
  } catch (error) {
    return redirectToSignIn(error, returnTo);
  }
}
