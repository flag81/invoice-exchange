import { createOAuthState } from '@einv/db';

import { serverEnv } from '@/lib/env';

import { oauthCookie } from '@/server/auth/cookies';
import { assertSameOrigin } from '@/server/auth/origin';
import { codeChallengeS256, createCodeVerifier } from '@/server/auth/pkce';
import { googleAuthorizationUrl, requireGoogleConfig } from '@/server/auth/providers/google';
import { GOOGLE_PROVIDER, redirectResponse, redirectToSignIn } from '@/server/auth/redirect';
import { DEFAULT_RETURN_TO, safeReturnTo } from '@/server/auth/return-to';
import { OAUTH_STATE_TTL_MS, randomToken } from '@/server/auth/tokens';

/**
 * `POST /api/auth/oauth/google/start` — the first half of the round trip.
 *
 * A `POST` from a form on `/signin`, answered with `303` to Google. POST rather than GET for a reason that
 * has nothing to do with REST: a `GET` link would be followed by link previewers, prefetchers and
 * antivirus proxies, each of which would create an `oauth_states` row and a cookie for a browser that
 * never intended to sign in. A form submission happens once, because a human pressed a button.
 *
 * What it writes, and why each part exists:
 *
 *   * a random `state` — compared on the way back, so a callback this browser did not start is refused;
 *   * a PKCE verifier — the code is worthless without it if it ever leaks;
 *   * a `nonce` — the ID token must echo it, which stops a token minted for another session from being
 *     replayed here;
 *   * the `returnTo` path — carried in the row (validated by `safeReturnTo`) so the callback does not have
 *     to trust a query string it received from Google.
 *
 * The row is the record; the cookie is the browser's half of it. Both are needed, and each covers a
 * different failure: the row stops a *replay*, the cookie stops a callback from *another browser*
 * (login CSRF) from completing someone else's attempt.
 */
export const dynamic = 'force-dynamic';

/** `next` from the form (the normal case) or the query string (a hand-written link in a test). */
async function readNextField(request: Request): Promise<string | null> {
  const form = await request.formData().catch(() => null);
  const fromForm = form?.get('next');

  if (typeof fromForm === 'string') {
    return fromForm;
  }

  return new URL(request.url).searchParams.get('next');
}

export async function POST(request: Request): Promise<Response> {
  let returnTo: string = DEFAULT_RETURN_TO;

  try {
    assertSameOrigin(request, serverEnv().APP_URL);

    const config = requireGoogleConfig();
    returnTo = safeReturnTo(await readNextField(request));

    const state = randomToken(32);
    const codeVerifier = createCodeVerifier();
    const nonce = randomToken(32);
    const now = new Date();

    await createOAuthState({
      provider: GOOGLE_PROVIDER,
      state,
      codeVerifier,
      nonce,
      returnTo: returnTo === DEFAULT_RETURN_TO ? null : returnTo,
      expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
    });

    const authorizeUrl = googleAuthorizationUrl(config, {
      state,
      nonce,
      codeChallenge: codeChallengeS256(codeVerifier),
    });

    return redirectResponse(authorizeUrl, [oauthCookie({ state, codeVerifier, nonce })]);
  } catch (error) {
    return redirectToSignIn(error, returnTo);
  }
}
