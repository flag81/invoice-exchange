/**
 * Cookies: reading one from a raw header, and the exact attributes each of ours is written with.
 *
 * The session cookie is `HttpOnly` (JavaScript cannot read it, so an XSS bug cannot exfiltrate it),
 * `SameSite=Lax` (it rides a top-level GET back from Google, but not a cross-site POST), `Secure` when the
 * deployment is https, and `Path=/`. The OAuth cookie is the same shape with a 10-minute life: it carries
 * the `state`, the PKCE verifier and the nonce for *one* attempt, and is deleted by the callback.
 *
 * Reading is done here rather than with `request.cookies` so the same code serves a route handler and a
 * test that builds a plain `Request`.
 */

import { serverEnv } from '@/lib/env';

import { OAUTH_STATE_TTL_MS, SESSION_TTL_MS } from './tokens';

/** The cookie name when `AUTH_SESSION_COOKIE_NAME` is not set. */
export const DEFAULT_SESSION_COOKIE = 'einv_session';

/** One OAuth attempt's state, verifier and nonce. Short-lived, cleared by the callback. */
export const OAUTH_COOKIE = 'einv_oauth';

export type CookieAttributes = {
  readonly name: string;
  readonly value: string;
  readonly path: string;
  readonly httpOnly: true;
  readonly sameSite: 'lax';
  readonly secure: boolean;
  readonly maxAge: number;
};

/** The configured session cookie name. */
export function sessionCookieName(): string {
  return serverEnv().AUTH_SESSION_COOKIE_NAME ?? DEFAULT_SESSION_COOKIE;
}

/**
 * Whether cookies get the `Secure` flag: yes when the deployment's own URL is https.
 *
 * `APP_URL` rather than the request's protocol, because a proxy that terminates TLS may not forward a
 * trustworthy `x-forwarded-proto`; the configured URL is the deployment's own statement about itself.
 */
export function secureCookies(): boolean {
  return serverEnv().APP_URL.startsWith('https://');
}

/**
 * One cookie's value from a `Cookie` header, or `null`.
 *
 * Parsing is deliberately small and strict: names are matched exactly, values are not unquoted beyond
 * stripping one pair of quotes, and a malformed pair is skipped rather than throwing. A cookie header is
 * attacker-controlled input, so the failure mode must be "no cookie", never an exception.
 */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (cookieHeader === null || cookieHeader === undefined || cookieHeader === '') {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');

    if (separator === -1) {
      continue;
    }

    if (part.slice(0, separator).trim() !== name) {
      continue;
    }

    const raw = part.slice(separator + 1).trim();

    return raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2 ? raw.slice(1, -1) : raw;
  }

  return null;
}

/** The session cookie, alive exactly as long as the row it names. */
export function sessionCookie(token: string, expiresAt: Date, now = new Date()): CookieAttributes {
  return {
    name: sessionCookieName(),
    value: token,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
  };
}

/** An already-expired cookie with the same attributes — how a value is deleted. */
export function expiredCookie(name: string): CookieAttributes {
  return {
    name,
    value: '',
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    maxAge: 0,
  };
}

/**
 * One `Set-Cookie` header value.
 *
 * Written here rather than through `NextResponse.cookies` so that a route can attach several cookies to
 * the *same* redirect response — `set-cookie` may repeat, and a 303 that carries both "here is your
 * session" and "your OAuth attempt is finished" is the whole callback in one round trip.
 */
export function serialiseCookie(cookie: CookieAttributes): string {
  const parts = [
    `${cookie.name}=${cookie.value}`,
    `Path=${cookie.path}`,
    `Max-Age=${String(cookie.maxAge)}`,
  ];

  parts.push(`SameSite=${cookie.sameSite === 'lax' ? 'Lax' : 'Strict'}`);

  if (cookie.httpOnly) {
    parts.push('HttpOnly');
  }

  if (cookie.secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/** What the OAuth cookie carries. Base64url JSON, so no value needs quoting. */
export type OAuthCookiePayload = {
  readonly state: string;
  readonly codeVerifier: string;
  readonly nonce: string;
};

export function oauthCookie(payload: OAuthCookiePayload): CookieAttributes {
  return {
    name: OAUTH_COOKIE,
    value: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
  };
}

/** The payload, or `null` for anything that is not exactly one well-formed attempt. */
export function parseOAuthCookie(value: string | null): OAuthCookiePayload | null {
  if (value === null || value === '') {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const { state, codeVerifier, nonce } = record;

  if (typeof state !== 'string' || typeof codeVerifier !== 'string' || typeof nonce !== 'string') {
    return null;
  }

  return state === '' || codeVerifier === '' || nonce === ''
    ? null
    : { state, codeVerifier, nonce };
}

/** The browser half of a session: `Max-Age` in seconds, from the row's absolute expiry. */
export const SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
