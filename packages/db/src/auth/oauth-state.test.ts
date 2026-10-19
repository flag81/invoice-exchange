/**
 * The single-use OAuth attempt.
 *
 * The interesting property is not that a row is written, it is that consuming is *atomic*: two
 * callbacks racing on one `state` must produce exactly one winner. That is `updateMany`'s count, and
 * these tests pin the count's meaning down — `0` means "already used, expired, or never issued", and
 * nothing is read in that case.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('../client', () => ({
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {},
  withDatabase: async (run: (client: unknown) => Promise<unknown>) => run({ oAuthState: db }),
}));

import { consumeOAuthState, createOAuthState } from './oauth-state';

const now = new Date('2026-10-17T10:00:00.000Z');
const expiresAt = new Date('2026-10-17T10:10:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();

  db.deleteMany.mockResolvedValue({ count: 0 });
  db.create.mockResolvedValue({});
  db.findUnique.mockResolvedValue(null);
});

describe('createOAuthState', () => {
  it('records the attempt with everything the callback will need', async () => {
    await createOAuthState({
      provider: 'google',
      state: 'state-1',
      codeVerifier: 'verifier-1',
      nonce: 'nonce-1',
      returnTo: '/invoices/abc',
      expiresAt,
    });

    expect(db.create).toHaveBeenCalledWith({
      data: {
        provider: 'google',
        state: 'state-1',
        codeVerifier: 'verifier-1',
        nonce: 'nonce-1',
        returnTo: '/invoices/abc',
        expiresAt,
      },
    });
  });

  it('sweeps abandoned attempts on the way in, so the table cannot grow without bound', async () => {
    await createOAuthState({
      provider: 'google',
      state: 'state-1',
      codeVerifier: 'verifier-1',
      nonce: 'nonce-1',
      returnTo: null,
      expiresAt,
    });

    expect(db.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: expect.any(Date) } } });
    expect(db.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      db.create.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });
});

describe('consumeOAuthState', () => {
  it('marks the row used with one conditional statement, which is what makes it single-use', async () => {
    db.updateMany.mockResolvedValue({ count: 1 });

    await consumeOAuthState({ provider: 'google', state: 'state-1', now });

    expect(db.updateMany).toHaveBeenCalledWith({
      where: {
        provider: 'google',
        state: 'state-1',
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
  });

  it('returns the verifier, nonce and return path for the callback', async () => {
    db.updateMany.mockResolvedValue({ count: 1 });
    db.findUnique.mockResolvedValue({
      codeVerifier: 'verifier-1',
      nonce: 'nonce-1',
      returnTo: '/invoices/abc',
    });

    await expect(consumeOAuthState({ provider: 'google', state: 'state-1', now })).resolves.toEqual(
      {
        codeVerifier: 'verifier-1',
        nonce: 'nonce-1',
        returnTo: '/invoices/abc',
      },
    );
  });

  it('returns null for a replayed callback, without reading anything the second time', async () => {
    // The second callback finds `consumed_at` already set, so its UPDATE matches no row.
    db.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      consumeOAuthState({ provider: 'google', state: 'state-1', now }),
    ).resolves.toBeNull();
    expect(db.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when the row disappeared between the update and the read', async () => {
    db.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      consumeOAuthState({ provider: 'google', state: 'state-1', now }),
    ).resolves.toBeNull();
  });

  it("scopes the state to its provider, so one provider's attempt cannot consume another's", async () => {
    db.updateMany.mockResolvedValue({ count: 0 });

    await consumeOAuthState({ provider: 'google', state: 'state-1', now });

    expect(db.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ provider: 'google', state: 'state-1' }),
      }),
    );
  });
});
