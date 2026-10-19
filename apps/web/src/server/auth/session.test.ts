/**
 * The session, resolved into an `Actor`.
 *
 * These tests are about the *order* and the *consequences*: the same-origin gate runs before the
 * database (a forged request must cost nothing), a dead session is one answer whatever killed it, the
 * lookup is by hash, and `last_seen_at` is written at most once every five minutes. The route tests
 * mock `requireActor`; this is where its behaviour is actually pinned down.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetServerEnv } from '@/lib/env';

import { sessionCookieName } from './cookies';
import { AuthErrorCode } from './errors';
import { sha256Hex, SESSION_TTL_MS } from './tokens';

const mocks = vi.hoisted(() => ({
  findActiveSession: vi.fn(),
  loadTenant: vi.fn(),
  touchSession: vi.fn(),
  createSession: vi.fn(),
  revokeSessionByTokenHash: vi.fn(),
  cookieStore: { get: vi.fn() },
}));

vi.mock('@einv/db', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  findActiveSession: mocks.findActiveSession,
  loadTenant: mocks.loadTenant,
  touchSession: mocks.touchSession,
  createSession: mocks.createSession,
  revokeSessionByTokenHash: mocks.revokeSessionByTokenHash,
}));

vi.mock('next/headers', () => ({ cookies: async () => mocks.cookieStore }));

import {
  clientIpAddress,
  currentActor,
  endSession,
  requireActor,
  signInIsConfigured,
  startSession,
} from './session';

const now = new Date('2026-10-17T10:00:00.000Z');
const later = new Date('2026-11-16T10:00:00.000Z');

const tenant = {
  companyId: 'company-1',
  companyName: 'Demo Market Sh.p.k',
  currency: 'EUR',
  countryCode: 'XK',
  taxRates: [],
  defaultTaxRateId: null,
};

const session = {
  sessionId: 'session-1',
  userId: 'user-1',
  email: 'arta@example.test',
  name: 'Arta',
  imageUrl: null,
  role: 'OWNER',
  companyId: 'company-1',
  lastSeenAt: now,
  expiresAt: later,
};

beforeEach(() => {
  vi.clearAllMocks();

  vi.stubEnv('APP_URL', 'https://app.example.test');
  resetServerEnv();

  mocks.findActiveSession.mockResolvedValue(session);
  mocks.loadTenant.mockResolvedValue(tenant);
  mocks.touchSession.mockResolvedValue(undefined);
  mocks.createSession.mockResolvedValue({ id: 'session-1' });
  mocks.revokeSessionByTokenHash.mockResolvedValue(undefined);
  mocks.cookieStore.get.mockReturnValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnv();
});

function request(init: { method?: string; headers?: Record<string, string> } = {}): Request {
  return new Request('https://app.example.test/api/invoices', {
    method: init.method ?? 'GET',
    headers: init.headers ?? {},
  });
}

function signedIn(token = 'token-1', headers: Record<string, string> = {}): Request {
  return request({
    method: 'POST',
    headers: { ...headers, cookie: `${sessionCookieName()}=${token}` },
  });
}

async function rejection(promise: Promise<unknown>): Promise<{ code?: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string };
  }

  throw new Error('expected the call to reject');
}

describe('requireActor — the CSRF gate comes first', () => {
  it('refuses a cross-origin write before reading the database', async () => {
    const response = signedIn('token-1', { origin: 'https://evil.example.test' });

    await expect(rejection(requireActor(response, now))).resolves.toMatchObject({
      code: AuthErrorCode.CROSS_ORIGIN,
    });
    expect(mocks.findActiveSession).not.toHaveBeenCalled();
  });

  it('refuses a cross-site write that named itself only through Sec-Fetch-Site', async () => {
    const response = signedIn('token-1', { 'sec-fetch-site': 'cross-site' });

    await expect(rejection(requireActor(response, now))).resolves.toMatchObject({
      code: AuthErrorCode.CROSS_ORIGIN,
    });
  });

  it('accepts a write from this origin', async () => {
    const response = signedIn('token-1', { origin: 'https://app.example.test' });

    await expect(requireActor(response, now)).resolves.toMatchObject({ userId: 'user-1' });
  });

  it('lets a read through, because a GET changes nothing', async () => {
    const response = request({ headers: { origin: 'https://evil.example.test' } });

    await expect(requireActor(response, now)).rejects.toMatchObject({
      code: AuthErrorCode.UNAUTHENTICATED,
    });
  });

  it('answers 401 rather than 403 for a same-origin write with no cookie', async () => {
    const response = request({ method: 'POST', headers: { origin: 'https://app.example.test' } });

    await expect(rejection(requireActor(response, now))).resolves.toMatchObject({
      code: AuthErrorCode.UNAUTHENTICATED,
    });
    expect(mocks.findActiveSession).not.toHaveBeenCalled();
  });
});

describe('requireActor — resolving the cookie', () => {
  it('looks the session up by hash, so the token itself never reaches a query', async () => {
    await requireActor(signedIn('token-1'), now);

    expect(mocks.findActiveSession).toHaveBeenCalledWith(sha256Hex('token-1'), now);
  });

  it('returns the actor with the tenant every query is scoped to', async () => {
    await expect(requireActor(signedIn('token-1'), now)).resolves.toEqual({
      sessionId: 'session-1',
      userId: 'user-1',
      email: 'arta@example.test',
      name: 'Arta',
      imageUrl: null,
      role: 'OWNER',
      tenant,
      expiresAt: later,
    });
  });

  it('answers 401 for a dead session — unknown, revoked, expired or removed all look the same', async () => {
    mocks.findActiveSession.mockResolvedValue(null);

    await expect(rejection(requireActor(signedIn('token-1'), now))).resolves.toMatchObject({
      code: AuthErrorCode.UNAUTHENTICATED,
    });
    expect(mocks.loadTenant).not.toHaveBeenCalled();
  });

  it('answers 401 when the company behind the session no longer exists', async () => {
    mocks.loadTenant.mockResolvedValue(null);

    await expect(rejection(requireActor(signedIn('token-1'), now))).resolves.toMatchObject({
      code: AuthErrorCode.UNAUTHENTICATED,
    });
  });

  it('touches last_seen_at only when it has gone stale', async () => {
    await requireActor(signedIn('token-1'), now);
    expect(mocks.touchSession).not.toHaveBeenCalled();

    const sixMinutesLater = new Date(now.getTime() + 6 * 60 * 1000);
    await requireActor(signedIn('token-1'), sixMinutesLater);
    expect(mocks.touchSession).toHaveBeenCalledWith('session-1', sixMinutesLater);
  });

  it('does not fail a valid request because the touch failed', async () => {
    mocks.touchSession.mockRejectedValue(new Error('write failed'));
    const stale = new Date(now.getTime() + 6 * 60 * 1000);

    await expect(requireActor(signedIn('token-1'), stale)).resolves.toMatchObject({
      sessionId: 'session-1',
    });
  });
});

describe('currentActor', () => {
  it('reads the same cookie for a page render', async () => {
    mocks.cookieStore.get.mockReturnValue({ value: 'token-1' });

    await expect(currentActor(now)).resolves.toMatchObject({ userId: 'user-1' });
    expect(mocks.cookieStore.get).toHaveBeenCalledWith(sessionCookieName());
  });

  it('returns null instead of throwing when there is no session, because a page can render signed out', async () => {
    await expect(currentActor(now)).resolves.toBeNull();
    expect(mocks.findActiveSession).not.toHaveBeenCalled();
  });
});

describe('clientIpAddress', () => {
  it('takes the first forwarded hop, which is the client the proxy saw', () => {
    const forwarded = request({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } });

    expect(clientIpAddress(forwarded)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip when nothing was forwarded', () => {
    expect(clientIpAddress(request({ headers: { 'x-real-ip': '203.0.113.7' } }))).toBe(
      '203.0.113.7',
    );
  });

  it('records nothing rather than an empty string', () => {
    expect(clientIpAddress(request())).toBeNull();
    expect(clientIpAddress(request({ headers: { 'x-forwarded-for': ' , 10.0.0.1' } }))).toBeNull();
  });

  it('truncates, because the header is client-controlled input on its way into a column', () => {
    const long = 'a'.repeat(200);

    expect(clientIpAddress(request({ headers: { 'x-forwarded-for': long } }))).toHaveLength(64);
  });
});

describe('signInIsConfigured', () => {
  it('is false when Google has not been configured, so the page can say so', () => {
    expect(signInIsConfigured()).toBe(false);
  });

  it('is true only when both halves of the client are present', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id');
    resetServerEnv();
    expect(signInIsConfigured()).toBe(false);

    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret');
    resetServerEnv();
    expect(signInIsConfigured()).toBe(true);
  });
});

describe('startSession', () => {
  const identity = {
    userId: 'user-1',
    email: 'arta@example.test',
    name: 'Arta',
    imageUrl: null,
    companyId: 'company-1',
    companyName: 'Demo Market Sh.p.k',
    role: 'OWNER',
  };

  it('stores the hash of the token it hands the browser, never the token', async () => {
    const result = await startSession(
      identity,
      request({
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.7', 'user-agent': 'Mozilla/5.0' },
      }),
      now,
    );

    expect(mocks.createSession).toHaveBeenCalledWith({
      userId: 'user-1',
      tokenHash: sha256Hex(result.cookie.value),
      companyId: 'company-1',
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });
    expect(result.cookie.value).not.toBe(sha256Hex(result.cookie.value));
    expect(result.expiresAt).toEqual(new Date(now.getTime() + SESSION_TTL_MS));
  });

  it('writes an HttpOnly, SameSite=Lax cookie that lives as long as the row', async () => {
    const { cookie } = await startSession(identity, request({ method: 'POST' }), now);

    expect(cookie).toMatchObject({
      name: sessionCookieName(),
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: SESSION_TTL_MS / 1000,
    });
  });

  it('issues a different token every time', async () => {
    const first = await startSession(identity, request(), now);
    const second = await startSession(identity, request(), now);

    expect(first.cookie.value).not.toBe(second.cookie.value);
  });
});

describe('endSession', () => {
  it('revokes the row behind the cookie by hash', async () => {
    const cookie = await endSession(signedIn('token-1'), now);

    expect(mocks.revokeSessionByTokenHash).toHaveBeenCalledWith(sha256Hex('token-1'), now);
    expect(cookie).toMatchObject({ name: sessionCookieName(), value: '', maxAge: 0 });
  });

  it('is a success when there is no cookie to revoke, and still clears the browser copy', async () => {
    const cookie = await endSession(request({ method: 'POST' }), now);

    expect(mocks.revokeSessionByTokenHash).not.toHaveBeenCalled();
    expect(cookie.maxAge).toBe(0);
  });
});
