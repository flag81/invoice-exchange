import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetServerEnv } from '@/lib/env';

import { sessionCookieName } from '@/server/auth/cookies';
import { sha256Hex } from '@/server/auth/tokens';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  findActiveSession: vi.fn(),
  loadTenant: vi.fn(),
  touchSession: vi.fn(),
  listMembershipsForUser: vi.fn(),
}));

vi.mock('@einv/db', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  findActiveSession: mocks.findActiveSession,
  loadTenant: mocks.loadTenant,
  touchSession: mocks.touchSession,
  listMembershipsForUser: mocks.listMembershipsForUser,
}));

const tenant = {
  companyId: 'company-1',
  companyName: 'Demo Market Sh.p.k',
  currency: 'EUR',
  countryCode: 'XK',
  taxRates: [],
  defaultTaxRateId: null,
};

const now = new Date();

const session = {
  sessionId: 'session-1',
  userId: 'user-1',
  email: 'arta@example.test',
  name: 'Arta Krasniqi',
  imageUrl: null,
  role: 'OWNER',
  companyId: 'company-1',
  expiresAt: new Date(now.getTime() + 60_000),
  lastSeenAt: now,
};

beforeEach(() => {
  vi.clearAllMocks();

  vi.stubEnv('APP_URL', 'http://localhost:3001');
  resetServerEnv();

  mocks.findActiveSession.mockResolvedValue(session);
  mocks.loadTenant.mockResolvedValue(tenant);
  mocks.touchSession.mockResolvedValue(undefined);
  mocks.listMembershipsForUser.mockResolvedValue([
    { companyId: 'company-1', companyName: 'Demo Market Sh.p.k', role: 'OWNER' },
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnv();
});

function sessionRequest(token?: string): Request {
  return new Request('http://localhost:3001/api/auth/session', {
    headers: token === undefined ? {} : { cookie: `${sessionCookieName()}=${token}` },
  });
}

describe('GET /api/auth/session', () => {
  it('answers who is signed in, as which company, and which companies they may act for', async () => {
    const response = await GET(sessionRequest('token-1'));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({
      user: {
        id: 'user-1',
        email: 'arta@example.test',
        name: 'Arta Krasniqi',
        imageUrl: null,
      },
      company: { id: 'company-1', name: 'Demo Market Sh.p.k', role: 'OWNER' },
      memberships: [{ companyId: 'company-1', companyName: 'Demo Market Sh.p.k', role: 'OWNER' }],
      expiresAt: session.expiresAt.toISOString(),
    });
  });

  it("looks the session up by the token's hash, so the token never reaches a query", async () => {
    await GET(sessionRequest('token-1'));

    expect(mocks.findActiveSession).toHaveBeenCalledWith(sha256Hex('token-1'), expect.any(Date));
    expect(mocks.findActiveSession).not.toHaveBeenCalledWith('token-1', expect.anything());
  });

  it('reads the company and role from the database, not from the cookie', async () => {
    await GET(sessionRequest('token-1'));

    expect(mocks.loadTenant).toHaveBeenCalledWith('company-1');
  });

  it('answers 401 UNAUTHENTICATED when the browser has no session cookie', async () => {
    const response = await GET(sessionRequest());
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(mocks.findActiveSession).not.toHaveBeenCalled();
  });

  it('answers 401 for a session that was revoked, expired or never existed', async () => {
    mocks.findActiveSession.mockResolvedValue(null);

    const response = await GET(sessionRequest('token-1'));

    expect(response.status).toBe(401);
    expect(mocks.loadTenant).not.toHaveBeenCalled();
  });

  it('answers 401 when the company behind the session is gone, rather than inventing a tenant', async () => {
    mocks.loadTenant.mockResolvedValue(null);

    const response = await GET(sessionRequest('token-1'));

    expect(response.status).toBe(401);
    expect(mocks.listMembershipsForUser).not.toHaveBeenCalled();
  });

  it("refreshes last_seen_at only when it is stale, so a page's four calls are one write", async () => {
    await GET(sessionRequest('token-1'));
    expect(mocks.touchSession).not.toHaveBeenCalled();

    mocks.findActiveSession.mockResolvedValue({
      ...session,
      lastSeenAt: new Date(now.getTime() - 10 * 60 * 1000),
    });

    await GET(sessionRequest('token-1'));
    expect(mocks.touchSession).toHaveBeenCalledWith('session-1', expect.any(Date));
  });
});
