import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetServerEnv } from '@/lib/env';

import { readCookie, sessionCookieName } from '@/server/auth/cookies';
import { sha256Hex } from '@/server/auth/tokens';

import { POST } from './route';

const mocks = vi.hoisted(() => ({ revokeSessionByTokenHash: vi.fn() }));

vi.mock('@einv/db', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  revokeSessionByTokenHash: mocks.revokeSessionByTokenHash,
}));

beforeEach(() => {
  vi.clearAllMocks();

  vi.stubEnv('APP_URL', 'http://localhost:3001');
  resetServerEnv();
  mocks.revokeSessionByTokenHash.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnv();
});

function logoutRequest(init: { readonly token?: string; readonly origin?: string } = {}): Request {
  const headers: Record<string, string> = {};

  if (init.token !== undefined) {
    headers.cookie = `${sessionCookieName()}=${init.token}`;
  }

  if (init.origin !== undefined) {
    headers.origin = init.origin;
  }

  return new Request('http://localhost:3001/api/auth/logout', { method: 'POST', headers });
}

describe('POST /api/auth/logout', () => {
  it('revokes the row and clears the cookie, so a copied cookie is worthless too', async () => {
    const response = await POST(logoutRequest({ token: 'token-1' }));
    const cookie = response.headers.getSetCookie()[0] ?? '';

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/signin');
    expect(mocks.revokeSessionByTokenHash).toHaveBeenCalledWith(
      sha256Hex('token-1'),
      expect.any(Date),
    );
    expect(readCookie(cookie.split(';')[0] ?? '', sessionCookieName())).toBe('');
    expect(cookie).toContain('Max-Age=0');
  });

  it('succeeds when there was no session: "I am not signed in" is already true', async () => {
    const response = await POST(logoutRequest());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/signin');
    expect(mocks.revokeSessionByTokenHash).not.toHaveBeenCalled();
  });

  it('refuses a cross-origin POST: no other page may sign this browser out', async () => {
    const response = await POST(
      logoutRequest({ token: 'token-1', origin: 'https://evil.example' }),
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('CROSS_ORIGIN');
    expect(mocks.revokeSessionByTokenHash).not.toHaveBeenCalled();
  });

  it('accepts the form post from the page itself', async () => {
    const response = await POST(
      logoutRequest({ token: 'token-1', origin: 'http://localhost:3001' }),
    );

    expect(response.status).toBe(303);
    expect(mocks.revokeSessionByTokenHash).toHaveBeenCalled();
  });
});
