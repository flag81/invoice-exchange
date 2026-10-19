import { DatabaseUnavailableError } from '@einv/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetServerEnv } from '@/lib/env';

import {
  OAUTH_COOKIE,
  oauthCookie,
  readCookie,
  sessionCookie,
  sessionCookieName,
} from '@/server/auth/cookies';
import { AuthError, AuthErrorCode } from '@/server/auth/errors';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  consumeOAuthState: vi.fn(),
  signInWithOAuth: vi.fn(),
  exchangeGoogleCode: vi.fn(),
  startSession: vi.fn(),
}));

vi.mock('@einv/db', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  consumeOAuthState: mocks.consumeOAuthState,
  signInWithOAuth: mocks.signInWithOAuth,
}));

vi.mock('@/server/auth/session', () => ({ startSession: mocks.startSession }));

// `requireGoogleConfig` stays real: the route must refuse without configuration, and that refusal is a
// redirect, not a crash. Only the network call to Google is replaced.
vi.mock('@/server/auth/providers/google', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  exchangeGoogleCode: mocks.exchangeGoogleCode,
}));

const ATTEMPT = {
  state: 'state-1',
  codeVerifier: 'verifier-1',
  nonce: 'nonce-1',
};

const identity = {
  userId: 'user-1',
  email: 'arta@example.test',
  name: 'Arta Krasniqi',
  imageUrl: null,
  companyId: 'company-1',
  companyName: 'Demo Market Sh.p.k',
  role: 'OWNER',
};

const profile = {
  provider: 'google',
  providerAccountId: 'google-sub-1',
  email: 'arta@example.test',
  emailVerified: true,
  name: 'Arta Krasniqi',
  imageUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks();

  vi.stubEnv('APP_URL', 'http://localhost:3001');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client-1');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret-1');
  resetServerEnv();

  mocks.consumeOAuthState.mockResolvedValue({
    codeVerifier: 'verifier-1',
    nonce: 'nonce-1',
    returnTo: '/invoices/abc',
  });
  mocks.exchangeGoogleCode.mockResolvedValue(profile);
  mocks.signInWithOAuth.mockResolvedValue(identity);
  mocks.startSession.mockResolvedValue({
    cookie: sessionCookie('token-1', new Date(Date.now() + 60_000)),
    expiresAt: new Date(Date.now() + 60_000),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnv();
});

/** The callback Google sends a browser back to, with the attempt cookie it was given. */
function callback(
  query: Record<string, string> = { state: ATTEMPT.state, code: 'code-1' },
  attempt: {
    readonly state: string;
    readonly codeVerifier: string;
    readonly nonce: string;
  } | null = ATTEMPT,
): Request {
  const url = new URL('http://localhost:3001/api/auth/oauth/google/callback');

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  return new Request(url, {
    headers: attempt === null ? {} : { cookie: `${OAUTH_COOKIE}=${oauthCookie(attempt).value}` },
  });
}

describe('GET /api/auth/oauth/google/callback — the successful round trip', () => {
  it('signs the person in and lands on the page they originally asked for', async () => {
    const response = await GET(callback());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/invoices/abc');
  });

  it('carries the new session and the deletion of the attempt in one response', async () => {
    const response = await GET(callback());
    const cookies = response.headers.getSetCookie();

    expect(cookies).toHaveLength(2);
    expect(readCookie(cookies[0]?.split(';')[0] ?? '', sessionCookieName())).toBe('token-1');
    expect(cookies[1]).toContain(`${OAUTH_COOKIE}=;`);
    expect(cookies[1]).toContain('Max-Age=0');
  });

  it('exchanges the code with the verifier and nonce from the stored attempt, never from the URL', async () => {
    await GET(callback());

    expect(mocks.exchangeGoogleCode).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ clientId: 'client-1' }) }),
      expect.objectContaining({
        code: 'code-1',
        codeVerifier: 'verifier-1',
        nonce: 'nonce-1',
        now: expect.any(Date),
      }),
    );
  });

  it('creates the session for the tenant the sign-in resolved, and records the attempt as used', async () => {
    const request = callback();

    await GET(request);

    expect(mocks.signInWithOAuth).toHaveBeenCalledWith(profile);
    expect(mocks.startSession).toHaveBeenCalledWith(identity, request, expect.any(Date));
    expect(mocks.consumeOAuthState).toHaveBeenCalledWith({
      provider: 'google',
      state: 'state-1',
      now: expect.any(Date),
    });
  });
});

describe('GET /api/auth/oauth/google/callback — a callback this browser did not start', () => {
  it('refuses when there is no attempt cookie, which is what stops login CSRF', async () => {
    const response = await GET(callback(undefined, null));

    expect(response.headers.get('location')).toBe('/signin?error=OAUTH_FAILED');
    expect(mocks.consumeOAuthState).not.toHaveBeenCalled();
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it("refuses when the cookie's state is not the one in the URL", async () => {
    const response = await GET(callback(undefined, { ...ATTEMPT, state: 'another-state' }));

    expect(response.headers.get('location')).toBe('/signin?error=OAUTH_FAILED');
    expect(mocks.consumeOAuthState).not.toHaveBeenCalled();
  });

  it('refuses before touching the database, so a forged callback costs nothing', async () => {
    await GET(callback({ state: 'state-1' }, null));

    expect(mocks.consumeOAuthState).not.toHaveBeenCalled();
    expect(mocks.exchangeGoogleCode).not.toHaveBeenCalled();
  });

  it('refuses a replayed callback even with a valid-looking cookie: the row is already used', async () => {
    mocks.consumeOAuthState.mockResolvedValue(null);

    const response = await GET(callback());

    expect(response.headers.get('location')).toBe('/signin?error=OAUTH_FAILED');
    expect(mocks.exchangeGoogleCode).not.toHaveBeenCalled();
    expect(mocks.startSession).not.toHaveBeenCalled();
  });
});

describe('GET /api/auth/oauth/google/callback — Google said no', () => {
  it('reports a cancelled consent screen as a failed attempt, keeping the wanted page', async () => {
    const response = await GET(callback({ state: 'state-1', error: 'access_denied' }));

    expect(response.headers.get('location')).toBe(
      '/signin?error=OAUTH_FAILED&next=%2Finvoices%2Fabc',
    );
    expect(mocks.exchangeGoogleCode).not.toHaveBeenCalled();
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it('still consumes the attempt: a refusal is the end of the round trip, not a pause', async () => {
    await GET(callback({ state: 'state-1', error: 'access_denied' }));

    expect(mocks.consumeOAuthState).toHaveBeenCalled();
  });

  it('refuses a callback with no code at all', async () => {
    const response = await GET(callback({ state: 'state-1' }));

    expect(response.headers.get('location')).toBe(
      '/signin?error=OAUTH_FAILED&next=%2Finvoices%2Fabc',
    );
    expect(mocks.exchangeGoogleCode).not.toHaveBeenCalled();
  });
});

describe('GET /api/auth/oauth/google/callback — refusals after the exchange', () => {
  it('reports an unverified-email refusal as EMAIL_UNVERIFIED, with the page to come back to', async () => {
    mocks.exchangeGoogleCode.mockRejectedValue(
      new AuthError(AuthErrorCode.EMAIL_UNVERIFIED, 'nope'),
    );

    const response = await GET(callback());

    expect(response.headers.get('location')).toBe(
      '/signin?error=EMAIL_UNVERIFIED&next=%2Finvoices%2Fabc',
    );
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it('reports a database outage as DATABASE_UNAVAILABLE rather than as a failed sign-in', async () => {
    mocks.signInWithOAuth.mockRejectedValue(new DatabaseUnavailableError('down'));

    const response = await GET(callback());

    expect(response.headers.get('location')).toBe(
      '/signin?error=DATABASE_UNAVAILABLE&next=%2Finvoices%2Fabc',
    );
  });

  it('reports a deployment without Google credentials as NOT_CONFIGURED', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    resetServerEnv();

    const response = await GET(callback());

    expect(response.headers.get('location')).toBe('/signin?error=NOT_CONFIGURED');
    expect(mocks.consumeOAuthState).not.toHaveBeenCalled();
  });
});
