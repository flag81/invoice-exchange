/**
 * Google sign-in, as three small steps: send the browser to Google, exchange the code, verify the ID token.
 *
 * There is no OAuth library here (ADR 0002 said so before this slice existed): the protocol is four form
 * fields and one JWT verification, `jose` does the part that must not be hand-written (RS256, `kid`
 * rotation, `aud`/`iss`/`exp`), and everything else is code you can read in one screen.
 *
 * Three details are the difference between "a login button" and a login button that is safe:
 *
 *   * **`nonce`** — the ID token must carry the nonce this browser's attempt generated. Without it, a
 *     token minted for another session of the same client could be replayed into this one.
 *   * **`email_verified`** — an unverified claim must never identify (or link to) an account.
 *   * **the code is exchanged with the PKCE verifier** — a code stolen from a shared redirect URI is
 *     useless without it.
 *
 * The discovery document is fetched once per process (`token_endpoint`, `jwks_uri`, `issuer`) and then
 * cached; Google's authorization endpoint is a constant because building the redirect must not need a
 * network round trip.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

import type { OAuthProfile } from '@einv/db';

import { serverEnv, type ServerEnv } from '@/lib/env';

import { AuthError, AuthErrorCode } from '../errors';
import { constantTimeEquals } from '../tokens';

/** Where the browser is sent. Stable for years; not worth a discovery round trip on the redirect path. */
export const GOOGLE_AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

/** The path Google calls back on. Registered in the Cloud console, exactly. */
export const GOOGLE_CALLBACK_PATH = '/api/auth/oauth/google/callback';

const GOOGLE_DISCOVERY_URL = 'https://accounts.google.com/.well-known/openid-configuration';

/** Google issues tokens with either spelling of its issuer, depending on the flow. */
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'] as const;

/** Only what is read from the discovery document. */
export type GoogleDiscovery = {
  readonly issuer: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
};

export type GoogleConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  /** The exact `redirect_uri` sent in both directions; Google compares it literally. */
  readonly redirectUri: string;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The absolute redirect URI, from `OAUTH_REDIRECT_BASE_URL` (or `APP_URL`). */
export function googleRedirectUri(env: ServerEnv = serverEnv()): string {
  const base = env.OAUTH_REDIRECT_BASE_URL ?? env.APP_URL;

  return `${base.replace(/\/+$/, '')}${GOOGLE_CALLBACK_PATH}`;
}

/**
 * The provider's settings, or `null` when Google sign-in is not configured.
 *
 * `null` is the honest answer for a fresh clone: the feature is off, and the sign-in page says why
 * instead of redirecting to Google with an empty client id and coming back with an opaque error.
 */
export function googleConfigOrNull(env: ServerEnv = serverEnv()): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;

  if (clientId === undefined || clientSecret === undefined) {
    return null;
  }

  return { clientId, clientSecret, redirectUri: googleRedirectUri(env) };
}

/** The same thing, for a route that cannot proceed without it. */
export function requireGoogleConfig(env: ServerEnv = serverEnv()): GoogleConfig {
  const config = googleConfigOrNull(env);

  if (config === null) {
    throw new AuthError(
      AuthErrorCode.NOT_CONFIGURED,
      'hyrja me Google nuk është konfiguruar: vendos GOOGLE_CLIENT_ID dhe GOOGLE_CLIENT_SECRET në .env',
      'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET missing',
    );
  }

  return config;
}

export type AuthorizationRequest = {
  readonly state: string;
  readonly codeChallenge: string;
  readonly nonce: string;
};

/**
 * The URL to redirect to, with PKCE, `state`, `nonce` and the scopes that produce an ID token.
 *
 * `prompt=select_account` is deliberate: on a shared laptop, signing in as the person who was last there
 * is the wrong default for an application that holds a company's invoices.
 */
export function googleAuthorizationUrl(
  config: GoogleConfig,
  request: AuthorizationRequest,
): string {
  const url = new URL(GOOGLE_AUTHORIZE_ENDPOINT);

  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', request.state);
  url.searchParams.set('nonce', request.nonce);
  url.searchParams.set('code_challenge', request.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');

  return url.toString();
}

let cachedDiscovery: GoogleDiscovery | undefined;

/** Forgets the cached discovery document. Used by tests that stub `fetch`. */
export function resetGoogleDiscoveryCache(): void {
  cachedDiscovery = undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDiscovery(value: unknown): GoogleDiscovery {
  if (!isRecord(value)) {
    throw new AuthError(
      AuthErrorCode.OAUTH_FAILED,
      'Google nuk ktheu një dokument zbulimi të lexueshëm',
      'discovery response was not an object',
    );
  }

  const { issuer, token_endpoint: tokenEndpoint, jwks_uri: jwksUri } = value;

  if (
    typeof issuer !== 'string' ||
    typeof tokenEndpoint !== 'string' ||
    typeof jwksUri !== 'string'
  ) {
    throw new AuthError(
      AuthErrorCode.OAUTH_FAILED,
      'dokumenti i zbulimit të Google nuk përmban token_endpoint/jwks_uri/issuer',
      'discovery document missing fields',
    );
  }

  return { issuer, token_endpoint: tokenEndpoint, jwks_uri: jwksUri };
}

async function fetchDiscovery(fetchImpl: FetchLike): Promise<GoogleDiscovery> {
  if (cachedDiscovery !== undefined) {
    return cachedDiscovery;
  }

  const response = await fetchImpl(GOOGLE_DISCOVERY_URL, {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new AuthError(
      AuthErrorCode.OAUTH_FAILED,
      'nuk u lexua konfigurimi i Google',
      `discovery answered ${String(response.status)}`,
    );
  }

  cachedDiscovery = readDiscovery(await response.json());

  return cachedDiscovery;
}

/** What the callback needs to verify a token. Tests inject `discovery` and `verificationKey`. */
export type ExchangeDeps = {
  readonly config: GoogleConfig;
  readonly fetchImpl?: FetchLike;
  /** Skip discovery (tests): the document Google would have served. */
  readonly discovery?: GoogleDiscovery;
  /** Skip the JWKS (tests): the public half of the key that signed the test token. */
  readonly verificationKey?: CryptoKey | Uint8Array;
};

export type ExchangeParams = {
  readonly code: string;
  readonly codeVerifier: string;
  /** The nonce from the attempt's cookie; the ID token must echo it. */
  readonly nonce: string;
  readonly now?: Date;
};

function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().toLowerCase();

  return trimmed === '' ? null : trimmed;
}

/**
 * Turns a verified ID token into the profile `signInWithOAuth` consumes.
 *
 * Every check here is a refusal, and each one has a reason: `sub` is the identity (an email can be
 * reassigned), the nonce binds the token to *this* attempt, `email_verified` is what makes the email
 * usable for linking, and `aud` is what stops a token minted for another Google client from being
 * accepted by this one (`jwtVerify` enforces that, with `iss` and `exp`).
 */
function profileFromPayload(
  payload: JWTPayload,
  expectedNonce: string,
  provider: string,
): OAuthProfile {
  const subject = payload.sub;
  const email = normaliseEmail(payload['email']);

  if (typeof subject !== 'string' || subject === '') {
    throw new AuthError(
      AuthErrorCode.OAUTH_FAILED,
      'Google nuk dha një identitet të vlefshëm',
      'id_token has no sub',
    );
  }

  if (typeof payload.nonce !== 'string' || !constantTimeEquals(payload.nonce, expectedNonce)) {
    throw new AuthError(
      AuthErrorCode.OAUTH_FAILED,
      'përgjigjja e Google nuk përputhet me këtë hyrje; provo përsëri',
      'id_token nonce mismatch',
    );
  }

  if (email === null) {
    throw new AuthError(
      AuthErrorCode.OAUTH_FAILED,
      'Google nuk dha një adresë email',
      'id_token has no email',
    );
  }

  // `true` only; a string "true" is not a verification, it is a claim about one.
  if (payload['email_verified'] !== true) {
    throw new AuthError(
      AuthErrorCode.EMAIL_UNVERIFIED,
      'Google nuk e konfirmon këtë adresë email; hyr me një llogari që e ka të konfirmuar',
      'email_verified was not true',
    );
  }

  const name = typeof payload['name'] === 'string' ? payload['name'].trim() : null;
  const picture = typeof payload['picture'] === 'string' ? payload['picture'] : null;

  return {
    provider,
    providerAccountId: subject,
    email,
    emailVerified: true,
    name: name === null || name === '' ? null : name,
    imageUrl: picture === null || picture === '' ? null : picture,
  };
}

/**
 * Exchanges the authorization code (with its PKCE verifier) and verifies the returned ID token.
 *
 * The token request is a form POST because that is what Google's token endpoint takes; the response is
 * parsed defensively, and a failure carries Google's own `error` in `detail` for the log while the user
 * gets a message that does not leak the provider's response.
 */
export async function exchangeGoogleCode(
  deps: ExchangeDeps,
  params: ExchangeParams,
): Promise<OAuthProfile> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const discovery = deps.discovery ?? (await fetchDiscovery(fetchImpl));
  const now = params.now ?? new Date();

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    client_id: deps.config.clientId,
    client_secret: deps.config.clientSecret,
    redirect_uri: deps.config.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const response = await fetchImpl(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form.toString(),
  });

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const providerError =
      isRecord(payload) && typeof payload['error'] === 'string' ? payload['error'] : 'unknown';

    throw new AuthError(
      AuthErrorCode.OAUTH_FAILED,
      'Google nuk pranoi këtë hyrje; provo përsëri',
      `token endpoint answered ${String(response.status)} (${providerError})`,
    );
  }

  const idToken = isRecord(payload) ? payload['id_token'] : undefined;

  if (typeof idToken !== 'string' || idToken === '') {
    throw new AuthError(
      AuthErrorCode.OAUTH_FAILED,
      'Google nuk ktheu një token identiteti',
      'token response has no id_token',
    );
  }

  const key = deps.verificationKey ?? createRemoteJWKSet(new URL(discovery.jwks_uri));

  let verified: JWTPayload;

  try {
    const result = await jwtVerify(idToken, key, {
      issuer: [...GOOGLE_ISSUERS],
      audience: deps.config.clientId,
      currentDate: now,
    });

    verified = result.payload;
  } catch (error) {
    throw new AuthError(
      AuthErrorCode.OAUTH_FAILED,
      'tokeni i identitetit nga Google nuk u verifikua',
      error instanceof Error ? error.message : 'jwtVerify failed',
    );
  }

  return profileFromPayload(verified, params.nonce, 'google');
}
