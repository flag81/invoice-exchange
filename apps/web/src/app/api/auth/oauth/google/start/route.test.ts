import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetServerEnv } from '@/lib/env';

import { OAUTH_COOKIE, parseOAuthCookie, readCookie } from '@/server/auth/cookies';

import { POST } from './route';

const mocks = vi.hoisted(() => ({ createOAuthState: vi.fn() }));

vi.mock('@einv/db', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  createOAuthState: mocks.createOAuthState,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APP_URL', 'http://localhost:3001');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client-1');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret-1');
  vi.stubEnv('OAUTH_REDIRECT_BASE_URL', '');
  resetServerEnv();
  mocks.createOAuthState.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnv();
});

function startRequest(init: { readonly next?: string; readonly origin?: string } = {}): Request {
  const body = new FormData();

  if (init.next !== undefined) {
    body.set('next', init.next);
  }

  return new Request('http://localhost:3001/api/auth/oauth/google/start', {
    method: 'POST',
    headers: init.origin === undefined ? {} : { origin: init.origin },
    body,
  });
}

/** The attempt cookie as the browser would store it. */
function storedAttempt(response: Response) {
  const header = response.headers.getSetCookie()[0] ?? '';

  return {
    header,
    value: parseOAuthCookie(readCookie(header.split(';')[0] ?? '', OAUTH_COOKIE)),
  };
}

describe('POST /api/auth/oauth/google/start', () => {
  it('answers with a 303 to Google carrying state, nonce and a PKCE challenge', async () => {
    const response = await POST(startRequest({ next: '/invoices/abc' }));
    const url = new URL(response.headers.get('location') ?? '');

    expect(response.status).toBe(303);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('state')).toHaveLength(43);
    expect(url.searchParams.get('nonce')).toHaveLength(43);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toHaveLength(43);
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3001/api/auth/oauth/google/callback',
    );
  });

  it('stores the same attempt it put in the cookie, so the callback can compare them', async () => {
    const response = await POST(startRequest({ next: '/invoices/abc' }));
    const attempt = storedAttempt(response);
    const stored = mocks.createOAuthState.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(attempt.value).not.toBeNull();
    expect(stored).toMatchObject({
      provider: 'google',
      state: attempt.value?.state,
      codeVerifier: attempt.value?.codeVerifier,
      nonce: attempt.value?.nonce,
      returnTo: '/invoices/abc',
    });
    expect(attempt.header).toContain('HttpOnly');
    expect(attempt.header).toContain('Max-Age=600');
  });

  it("expires the attempt in ten minutes, which is the row's own TTL", async () => {
    await POST(startRequest({ next: '/invoices/abc' }));

    const stored = mocks.createOAuthState.mock.calls[0]?.[0] as { expiresAt: Date };
    const lifetime = stored.expiresAt.getTime() - Date.now();

    expect(lifetime).toBeGreaterThan(9 * 60 * 1000);
    expect(lifetime).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it('keeps the path it was asked for in the row, not in a query Google could rewrite', async () => {
    await POST(startRequest({ next: '/invoices/abc' }));

    expect(mocks.createOAuthState).toHaveBeenCalledWith(
      expect.objectContaining({ returnTo: '/invoices/abc' }),
    );
  });

  it('stores no return path for the home screen, because there is nothing to return to', async () => {
    await POST(startRequest());

    expect(mocks.createOAuthState).toHaveBeenCalledWith(
      expect.objectContaining({ returnTo: null }),
    );
  });

  it('refuses an open redirect before it writes anything', async () => {
    await POST(startRequest({ next: '//evil.example/steal' }));

    expect(mocks.createOAuthState).toHaveBeenCalledWith(
      expect.objectContaining({ returnTo: null }),
    );
  });

  it('lands on /signin with NOT_CONFIGURED when the two Google variables are absent', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    resetServerEnv();

    const response = await POST(startRequest());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/signin?error=NOT_CONFIGURED');
    expect(mocks.createOAuthState).not.toHaveBeenCalled();
  });

  it('refuses a form post from another origin: this route sets cookies', async () => {
    const response = await POST(startRequest({ origin: 'https://evil.example' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/signin?error=CROSS_ORIGIN');
    expect(mocks.createOAuthState).not.toHaveBeenCalled();
  });
});
