import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetServerEnv } from '@/lib/env';

import {
  DEFAULT_SESSION_COOKIE,
  OAUTH_COOKIE,
  expiredCookie,
  oauthCookie,
  parseOAuthCookie,
  readCookie,
  secureCookies,
  serialiseCookie,
  sessionCookie,
  sessionCookieName,
} from './cookies';

const NOW = new Date('2026-10-17T10:00:00.000Z');

beforeEach(() => {
  vi.stubEnv('APP_URL', 'https://app.example.test');
  vi.stubEnv('AUTH_SESSION_COOKIE_NAME', '');
  resetServerEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnv();
});

describe('readCookie', () => {
  it('finds a cookie by its exact name among others', () => {
    expect(readCookie('a=1; einv_session=abc; b=2', 'einv_session')).toBe('abc');
  });

  it('does not match a name that merely ends with the one asked for', () => {
    expect(readCookie('not_einv_session=abc', 'einv_session')).toBeNull();
  });

  it('survives a malformed header rather than throwing — a cookie is attacker input', () => {
    expect(readCookie('novalue; einv_session=abc', 'einv_session')).toBe('abc');
    expect(readCookie('novalue', 'einv_session')).toBeNull();
    expect(readCookie('', 'einv_session')).toBeNull();
    expect(readCookie(null, 'einv_session')).toBeNull();
  });

  it('strips one pair of surrounding quotes, because that is all a quotes-optional grammar means', () => {
    expect(readCookie('einv_session="abc"', 'einv_session')).toBe('abc');
  });

  it('reports a name that is present but empty as an empty value, not as missing', () => {
    expect(readCookie('einv_session=', 'einv_session')).toBe('');
  });
});

describe('sessionCookie', () => {
  it('lives exactly as long as the row it names, and is HttpOnly and Lax', () => {
    const cookie = sessionCookie('token', new Date('2026-10-19T10:00:00.000Z'), NOW);

    expect(cookie).toEqual({
      name: DEFAULT_SESSION_COOKIE,
      value: 'token',
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 2 * 24 * 60 * 60,
    });
  });

  it('is not Secure on an http deployment, or the browser would drop it in development', () => {
    vi.stubEnv('APP_URL', 'http://localhost:3001');
    resetServerEnv();

    expect(sessionCookie('token', new Date('2026-10-19T10:00:00.000Z'), NOW).secure).toBe(false);
    expect(secureCookies()).toBe(false);
  });

  it('never has a negative Max-Age for an already-expired row', () => {
    expect(sessionCookie('token', new Date('2026-10-16T10:00:00.000Z'), NOW).maxAge).toBe(0);
  });

  it('uses the configured name, which is how a deployment signs everybody out at once', () => {
    vi.stubEnv('AUTH_SESSION_COOKIE_NAME', 'einv_session_v2');
    resetServerEnv();

    expect(sessionCookieName()).toBe('einv_session_v2');
    expect(sessionCookie('token', new Date('2026-11-16T10:00:00.000Z'), NOW).name).toBe(
      'einv_session_v2',
    );
  });
});

describe('expiredCookie', () => {
  it('is the same cookie with Max-Age=0 — the only portable way to delete one', () => {
    expect(expiredCookie(OAUTH_COOKIE)).toMatchObject({
      name: OAUTH_COOKIE,
      value: '',
      maxAge: 0,
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });
  });
});

describe('serialiseCookie', () => {
  it('writes the attributes a browser needs, in the order it expects to read them', () => {
    expect(
      serialiseCookie({
        name: 'einv_session',
        value: 'abc',
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        maxAge: 60,
      }),
    ).toBe('einv_session=abc; Path=/; Max-Age=60; SameSite=Lax; HttpOnly; Secure');
  });

  it('omits Secure where it would break development', () => {
    vi.stubEnv('APP_URL', 'http://localhost:3001');
    resetServerEnv();

    expect(serialiseCookie(expiredCookie('x'))).toBe(
      'x=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly',
    );
  });
});

describe('the OAuth attempt cookie', () => {
  const payload = { state: 'state-1', codeVerifier: 'verifier-1', nonce: 'nonce-1' };

  it('round-trips state, verifier and nonce, with a ten-minute life', () => {
    const cookie = oauthCookie(payload);

    expect(cookie.name).toBe(OAUTH_COOKIE);
    expect(cookie.maxAge).toBe(600);
    expect(parseOAuthCookie(cookie.value)).toEqual(payload);
  });

  it('is base64url, so neither the value nor the header needs quoting', () => {
    expect(oauthCookie(payload).value).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('parses anything malformed as "no attempt", never as a partial one', () => {
    for (const value of [
      null,
      '',
      'not-base64-json',
      Buffer.from('[]', 'utf8').toString('base64url'),
      Buffer.from(JSON.stringify({ state: 'a' }), 'utf8').toString('base64url'),
      Buffer.from(JSON.stringify({ ...payload, nonce: 42 }), 'utf8').toString('base64url'),
      Buffer.from(JSON.stringify({ ...payload, codeVerifier: '' }), 'utf8').toString('base64url'),
    ]) {
      expect(parseOAuthCookie(value)).toBeNull();
    }
  });
});
