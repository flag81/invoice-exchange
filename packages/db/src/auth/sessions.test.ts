/**
 * The server-side session row.
 *
 * What matters here is the *reading*: a session that is unknown, revoked, expired, stripped of its
 * company, or whose membership is gone must all come back as `null` — one answer, "sign in again" —
 * and the actor's role must be re-read from the membership rather than trusted from anywhere else.
 * The queries themselves are Prisma calls; the fake client below records what they were asked, which
 * is the part this package owns.
 */

import { Role } from '@einv/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  session: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  membership: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../client', () => ({
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {},
  withDatabase: async (run: (client: unknown) => Promise<unknown>) => run(db),
}));

import {
  createSession,
  findActiveSession,
  revokeSessionByTokenHash,
  touchSession,
} from './sessions';

const now = new Date('2026-10-17T10:00:00.000Z');
const later = new Date('2026-11-16T10:00:00.000Z');

const row = {
  id: 'session-1',
  userId: 'user-1',
  tokenHash: 'hash-1',
  activeCompanyId: 'company-1',
  revokedAt: null as Date | null,
  lastSeenAt: now,
  expiresAt: later,
  user: { email: 'arta@example.test', name: 'Arta', imageUrl: null },
  activeCompany: { id: 'company-1', name: 'NPT Kafe' },
};

beforeEach(() => {
  vi.clearAllMocks();

  db.session.create.mockResolvedValue({ id: 'session-1' });
  db.session.findUnique.mockResolvedValue(row);
  db.session.update.mockResolvedValue({});
  db.session.updateMany.mockResolvedValue({ count: 1 });
  db.membership.findUnique.mockResolvedValue({ role: Role.OWNER });
});

describe('createSession', () => {
  it('stores the hash, not the token, and the company the session acts for', async () => {
    await createSession({
      userId: 'user-1',
      tokenHash: 'hash-1',
      companyId: 'company-1',
      expiresAt: later,
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });

    expect(db.session.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        tokenHash: 'hash-1',
        activeCompanyId: 'company-1',
        expiresAt: later,
        ipAddress: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
      },
      select: { id: true },
    });
  });

  it('records absent request details as null rather than leaving them undefined', async () => {
    await createSession({
      userId: 'user-1',
      tokenHash: 'hash-1',
      companyId: 'company-1',
      expiresAt: later,
    });

    expect(db.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ipAddress: null, userAgent: null }),
      }),
    );
  });
});

describe('findActiveSession', () => {
  it('returns the actor and the tenant the session is scoped to', async () => {
    await expect(findActiveSession('hash-1', now)).resolves.toEqual({
      sessionId: 'session-1',
      userId: 'user-1',
      email: 'arta@example.test',
      name: 'Arta',
      imageUrl: null,
      companyId: 'company-1',
      companyName: 'NPT Kafe',
      role: Role.OWNER,
      lastSeenAt: now,
      expiresAt: later,
    });
  });

  it('looks the row up by hash alone: the token never reaches the database', async () => {
    await findActiveSession('hash-1', now);

    expect(db.session.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: 'hash-1' },
      include: { user: true, activeCompany: true },
    });
  });

  it('returns null for an unknown token', async () => {
    db.session.findUnique.mockResolvedValue(null);

    await expect(findActiveSession('nope', now)).resolves.toBeNull();
    expect(db.membership.findUnique).not.toHaveBeenCalled();
  });

  it('returns null for a revoked session, even before it expires', async () => {
    db.session.findUnique.mockResolvedValue({
      ...row,
      revokedAt: new Date('2026-10-17T09:00:00.000Z'),
    });

    await expect(findActiveSession('hash-1', now)).resolves.toBeNull();
  });

  it('returns null once the session expires, treating the expiry instant as expired', async () => {
    db.session.findUnique.mockResolvedValue({ ...row, expiresAt: now });

    await expect(findActiveSession('hash-1', now)).resolves.toBeNull();
  });

  it('returns null when the session has no active company', async () => {
    db.session.findUnique.mockResolvedValue({ ...row, activeCompanyId: null, activeCompany: null });

    await expect(findActiveSession('hash-1', now)).resolves.toBeNull();
  });

  it('returns null when the company was deleted under the session', async () => {
    db.session.findUnique.mockResolvedValue({ ...row, activeCompany: null });

    await expect(findActiveSession('hash-1', now)).resolves.toBeNull();
  });

  it('returns null when the membership was removed, so access ends with the membership', async () => {
    db.membership.findUnique.mockResolvedValue(null);

    await expect(findActiveSession('hash-1', now)).resolves.toBeNull();
  });

  it('reads the role from the membership, so a demotion applies on the next request', async () => {
    db.membership.findUnique.mockResolvedValue({ role: Role.ACCOUNTANT });

    await expect(findActiveSession('hash-1', now)).resolves.toMatchObject({
      role: Role.ACCOUNTANT,
    });
    expect(db.membership.findUnique).toHaveBeenCalledWith({
      where: { userId_companyId: { userId: 'user-1', companyId: 'company-1' } },
      select: { role: true },
    });
  });

  it('fails closed to VIEWER when the stored role is not one it knows', async () => {
    db.membership.findUnique.mockResolvedValue({ role: 'SUPERUSER' });

    await expect(findActiveSession('hash-1', now)).resolves.toMatchObject({ role: Role.VIEWER });
  });
});

describe('touchSession', () => {
  it('records the last use on the row, keyed by session id', async () => {
    await touchSession('session-1', now);

    expect(db.session.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { lastSeenAt: now },
    });
  });
});

describe('revokeSessionByTokenHash', () => {
  it('marks the row revoked instead of deleting it, so history stays answerable', async () => {
    await revokeSessionByTokenHash('hash-1', now);

    expect(db.session.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: 'hash-1', revokedAt: null },
      data: { revokedAt: now },
    });
  });

  it('is a success when there is nothing to revoke, so signing out twice is not an error', async () => {
    db.session.updateMany.mockResolvedValue({ count: 0 });

    await expect(revokeSessionByTokenHash('hash-1', now)).resolves.toBeUndefined();
  });
});
