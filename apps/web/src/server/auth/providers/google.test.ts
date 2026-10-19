import { generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseServerEnv } from '@/lib/env';

import { AuthError, AuthErrorCode } from '../errors';
import {
  GOOGLE_AUTHORIZE_ENDPOINT,
  GOOGLE_CALLBACK_PATH,
  exchangeGoogleCode,
  googleAuthorizationUrl,
  googleConfigOrNull,
  googleRedirectUri,
  requireGoogleConfig,
  type FetchLike,
  type GoogleConfig,
  type GoogleDiscovery,
} from './google';

const NONCE = 'nonce-from-the-attempt';
const NOW_SECONDS = Math.floor(Date.parse('2026-10-17T10:00:00.000Z') / 1000);
const NOW = new Date(NOW_SECONDS * 1000);

const DISCOVERY: GoogleDiscovery = {
  issuer: 'https://accounts.google.com',
  token_endpoint: 'https://oauth2.googleapis.test/token',
  jwks_uri: 'https://www.googleapis.test/oauth2/v3/certs',
};

function config(overrides: Record<string, string> = {}): GoogleConfig {
  const env = parseServerEnv({
    GOOGLE_CLIENT_ID: 'client-1',
    GOOGLE_CLIENT_SECRET: 'secret-1',
    ...overrides,
  });

  return requireGoogleConfig(env);
}

let privateKey: CryptoKey;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');

  // Node's WebCrypto path returns `CryptoKey`s; the cast narrows a union that also covers KeyObject.
  privateKey = pair.privateKey as CryptoKey;
  publicKey = pair.publicKey as CryptoKey;
});

/** An ID token shaped like Google's, with any claim overridable so a refusal can be provoked. */
async function idToken(
  options: {
    readonly sub?: string | null;
    readonly aud?: string;
    readonly claims?: Record<string, unknown>;
  } = {},
): Promise<string> {
  const { sub = 'google-sub-1', aud = 'client-1', claims = {} } = options;
  const jwt = new SignJWT({
    email: 'Arta@Example.test',
    email_verified: true,
    nonce: NONCE,
    name: 'Arta Krasniqi',
    picture: 'https://images.test/arta.png',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://accounts.google.com')
    .setAudience(aud)
    .setIssuedAt(NOW_SECONDS)
    .setExpirationTime(NOW_SECONDS + 600);

  return (sub === null ? jwt : jwt.setSubject(sub)).sign(privateKey);
}

/** A token endpoint that answers with exactly the body a test needs. */
function tokenEndpoint(body: unknown, status = 200): FetchLike {
  return () => Promise.resolve(Response.json(body, { status }));
}

describe('googleRedirectUri', () => {
  it('is APP_URL plus the path registered in the Cloud console', () => {
    const env = parseServerEnv({ APP_URL: 'https://invoices.example.test' });

    expect(googleRedirectUri(env)).toBe(`https://invoices.example.test${GOOGLE_CALLBACK_PATH}`);
  });

  it('prefers OAUTH_REDIRECT_BASE_URL, and does not double a trailing slash', () => {
    const env = parseServerEnv({
      APP_URL: 'https://invoices.example.test',
      OAUTH_REDIRECT_BASE_URL: 'https://proxy.example.test/',
    });

    expect(googleRedirectUri(env)).toBe(`https://proxy.example.test${GOOGLE_CALLBACK_PATH}`);
  });
});

describe('the configuration', () => {
  it('is absent — not guessed — when either key is missing', () => {
    expect(googleConfigOrNull(parseServerEnv({ GOOGLE_CLIENT_ID: 'client-1' }))).toBeNull();
    expect(googleConfigOrNull(parseServerEnv({ GOOGLE_CLIENT_SECRET: 'secret-1' }))).toBeNull();
  });

  it('names both variables when a route cannot proceed without them', () => {
    expect.assertions(2);

    try {
      requireGoogleConfig(parseServerEnv({}));
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe(AuthErrorCode.NOT_CONFIGURED);
    }
  });
});

describe('googleAuthorizationUrl', () => {
  const url = new URL(
    googleAuthorizationUrl(config(), {
      state: 'state-1',
      nonce: 'nonce-1',
      codeChallenge: 'challenge-1',
    }),
  );

  it("goes to Google's authorization endpoint with a code flow", () => {
    expect(url.origin + url.pathname).toBe(GOOGLE_AUTHORIZE_ENDPOINT);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });

  it('carries state, nonce and a PKCE S256 challenge — the three things that make the trip safe', () => {
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('nonce')).toBe('nonce-1');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('sends the exact registered redirect URI and the configured client', () => {
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('redirect_uri')).toBe(
      `http://localhost:3001${GOOGLE_CALLBACK_PATH}`,
    );
  });

  it('always asks which account, because a shared laptop must not sign in the last person', () => {
    expect(url.searchParams.get('prompt')).toBe('select_account');
  });

  it('never includes the client secret', () => {
    expect(url.toString()).not.toContain('secret-1');
  });
});

describe('exchangeGoogleCode', () => {
  const conf = config();

  /** The one call shape every case below uses; only the token endpoint's answer changes. */
  function exchange(fetchImpl: FetchLike, nonce = NONCE) {
    return exchangeGoogleCode(
      { config: conf, discovery: DISCOVERY, verificationKey: publicKey, fetchImpl },
      { code: 'code-1', codeVerifier: 'verifier-1', nonce, now: NOW },
    );
  }

  it('turns a verified ID token into the profile sign-in consumes', async () => {
    const profile = await exchange(tokenEndpoint({ id_token: await idToken() }));

    expect(profile).toEqual({
      provider: 'google',
      providerAccountId: 'google-sub-1',
      // Normalised, because `users.email` is unique on the trimmed, lower-cased form.
      email: 'arta@example.test',
      emailVerified: true,
      name: 'Arta Krasniqi',
      imageUrl: 'https://images.test/arta.png',
    });
  });

  it('exchanges the code with the PKCE verifier and the same redirect URI it started with', async () => {
    let sent: URLSearchParams | undefined;
    const fetchImpl: FetchLike = (_input, init) => {
      sent = new URLSearchParams(String(init?.body));

      return idToken().then((token) => Response.json({ id_token: token }));
    };

    await exchange(fetchImpl);

    expect(sent?.get('grant_type')).toBe('authorization_code');
    expect(sent?.get('code')).toBe('code-1');
    expect(sent?.get('code_verifier')).toBe('verifier-1');
    expect(sent?.get('redirect_uri')).toBe(conf.redirectUri);
    expect(sent?.get('client_id')).toBe('client-1');
  });

  it('refuses a token minted for another attempt: the nonce is the binding', async () => {
    await expect(
      exchange(tokenEndpoint({ id_token: await idToken({ claims: { nonce: 'other-nonce' } }) })),
    ).rejects.toMatchObject({ code: AuthErrorCode.OAUTH_FAILED });
  });

  it('refuses a token with no nonce at all', async () => {
    await expect(
      exchange(tokenEndpoint({ id_token: await idToken({ claims: { nonce: null } }) })),
    ).rejects.toMatchObject({ code: AuthErrorCode.OAUTH_FAILED });
  });

  it('refuses a token issued for another Google client (`aud`), which jwtVerify enforces', async () => {
    await expect(
      exchange(tokenEndpoint({ id_token: await idToken({ aud: 'another-client' }) })),
    ).rejects.toMatchObject({ code: AuthErrorCode.OAUTH_FAILED });
  });

  it('refuses a token with no subject: the email is not the identity, the `sub` is', async () => {
    await expect(
      exchange(tokenEndpoint({ id_token: await idToken({ sub: null }) })),
    ).rejects.toMatchObject({ code: AuthErrorCode.OAUTH_FAILED });
  });

  it('refuses anything but a literal `email_verified: true` — a string is a claim, not a check', async () => {
    for (const emailVerified of [false, 'true', null]) {
      await expect(
        exchange(
          tokenEndpoint({ id_token: await idToken({ claims: { email_verified: emailVerified } }) }),
        ),
      ).rejects.toMatchObject({ code: AuthErrorCode.EMAIL_UNVERIFIED });
    }
  });

  it("reports a refused exchange as OAUTH_FAILED, keeping Google's own error for the log", async () => {
    await expect(exchange(tokenEndpoint({ error: 'invalid_grant' }, 400))).rejects.toMatchObject({
      code: AuthErrorCode.OAUTH_FAILED,
      detail: 'token endpoint answered 400 (invalid_grant)',
    });
  });

  it('refuses a 200 response that carries no id_token', async () => {
    await expect(exchange(tokenEndpoint({ access_token: 'a' }))).rejects.toMatchObject({
      code: AuthErrorCode.OAUTH_FAILED,
    });
  });

  it('does not accept a token signed by a key it does not trust', async () => {
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({
      email: 'arta@example.test',
      email_verified: true,
      nonce: NONCE,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://accounts.google.com')
      .setAudience('client-1')
      .setSubject('google-sub-1')
      .setIssuedAt(NOW_SECONDS)
      .setExpirationTime(NOW_SECONDS + 600)
      .sign(other.privateKey);

    await expect(exchange(tokenEndpoint({ id_token: forged }))).rejects.toMatchObject({
      code: AuthErrorCode.OAUTH_FAILED,
    });
  });
});
