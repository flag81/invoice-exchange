import { DatabaseUnavailableError } from '@einv/db';
import { DomainError, DomainErrorCode } from '@einv/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetServerEnv } from '@/lib/env';

import { OAUTH_COOKIE, readCookie } from './cookies';
import { AuthError, AuthErrorCode } from './errors';
import { authErrorCodeOf, redirectResponse, redirectToSignIn } from './redirect';

beforeEach(() => {
  vi.stubEnv('APP_URL', 'http://localhost:3001');
  resetServerEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetServerEnv();
});

describe('authErrorCodeOf', () => {
  it("keeps an auth error's own code", () => {
    expect(authErrorCodeOf(new AuthError(AuthErrorCode.NOT_CONFIGURED, 'x'))).toBe(
      'NOT_CONFIGURED',
    );
  });

  it("translates the domain's refusal to link an unverified email into EMAIL_UNVERIFIED", () => {
    // `signInWithOAuth` refuses with PERMISSION_DENIED; the sign-in page has a sentence only for the
    // auth-side name, which is the one a person can act on.
    expect(authErrorCodeOf(new DomainError(DomainErrorCode.PERMISSION_DENIED, 'nope'))).toBe(
      AuthErrorCode.EMAIL_UNVERIFIED,
    );
  });

  it('names a database outage as such, because "provo përsëri" is the correct advice', () => {
    expect(authErrorCodeOf(new DatabaseUnavailableError('down'))).toBe('DATABASE_UNAVAILABLE');
  });

  it('reports a bug as OAUTH_FAILED, and logs it — the redirect body cannot carry a stack', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bug = new TypeError('a bug');

    expect(authErrorCodeOf(bug)).toBe(AuthErrorCode.OAUTH_FAILED);
    expect(logged).toHaveBeenCalledWith('[auth] sign-in failed', bug);
  });

  it('does not treat another domain error as an unverified email', () => {
    expect(authErrorCodeOf(new DomainError(DomainErrorCode.STATE_CONFLICT, 'nope'))).toBe(
      AuthErrorCode.OAUTH_FAILED,
    );
  });
});

describe('redirectResponse', () => {
  it('is a 303 with a Location and no body, so a POST becomes the GET it points at', async () => {
    const response = redirectResponse('/signin');

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/signin');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  it('carries several cookies in one response, which is how the callback lands in one trip', () => {
    const response = redirectResponse('/invoices', [
      {
        name: 'einv_session',
        value: 'abc',
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 60,
      },
      {
        name: OAUTH_COOKIE,
        value: '',
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 0,
      },
    ]);

    const cookies = response.headers.getSetCookie();

    expect(cookies).toHaveLength(2);
    expect(readCookie(cookies[0]?.split(';')[0] ?? '', 'einv_session')).toBe('abc');
    expect(cookies[1]).toContain(`${OAUTH_COOKIE}=`);
    expect(cookies[1]).toContain('Max-Age=0');
  });
});

describe('redirectToSignIn', () => {
  it('lands on /signin with the code and the page that failed, and clears the attempt', () => {
    const response = redirectToSignIn(
      new AuthError(AuthErrorCode.OAUTH_FAILED, 'x'),
      '/invoices/1',
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      '/signin?error=OAUTH_FAILED&next=%2Finvoices%2F1',
    );
    expect(response.headers.getSetCookie().join(';')).toContain(`${OAUTH_COOKIE}=;`);
  });

  it("never puts the provider's message in the URL", () => {
    const response = redirectToSignIn(
      new AuthError(AuthErrorCode.OAUTH_FAILED, 'x', 'access_denied for client 123'),
    );

    expect(response.headers.get('location')).toBe('/signin?error=OAUTH_FAILED');
  });
});
