/**
 * Signing in: which user, which company, in which order.
 *
 * These tests run against a fake transaction (`vi.mock('../client')`), because what matters here is not
 * SQL but the decision tree: identity by `sub` first, email only when verified, and a company that is
 * adopted before it is created. The transaction is faked as a function call, so "nothing was written"
 * is observable — which is exactly the assertion the unverified-email case needs.
 */

import { DomainErrorCode } from '@einv/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  oAuthAccount: { findUnique: vi.fn(), upsert: vi.fn() },
  user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  membership: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  company: { findFirst: vi.fn(), create: vi.fn() },
}));

vi.mock('../client', () => ({
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {},
  withDatabase: async (run: (client: unknown) => Promise<unknown>) =>
    run({
      ...db,
      $transaction: (transaction: (tx: unknown) => Promise<unknown>) => transaction(db),
    }),
}));

import { listMembershipsForUser, signInWithOAuth, type OAuthProfile } from './accounts';

const profile: OAuthProfile = {
  provider: 'google',
  providerAccountId: 'google-sub-1',
  email: 'arta@example.test',
  emailVerified: true,
  name: 'Arta Krasniqi',
  imageUrl: 'https://images.test/arta.png',
};

const verifiedAt = new Date('2025-01-01T00:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();

  db.oAuthAccount.findUnique.mockResolvedValue(null);
  db.oAuthAccount.upsert.mockResolvedValue({});
  db.user.findUnique.mockResolvedValue(null);
  db.membership.findFirst.mockResolvedValue(null);
  db.membership.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...data }),
  );
  db.company.findFirst.mockResolvedValue(null);
});

describe('signInWithOAuth — a Google account already linked', () => {
  beforeEach(() => {
    db.oAuthAccount.findUnique.mockResolvedValue({
      userId: 'user-1',
      user: {
        id: 'user-1',
        email: 'arta@example.test',
        name: 'Arta',
        imageUrl: null,
        emailVerifiedAt: verifiedAt,
      },
    });
    db.user.update.mockResolvedValue({
      id: 'user-1',
      email: 'arta@example.test',
      name: 'Arta Krasniqi',
      imageUrl: 'https://images.test/arta.png',
    });
    db.membership.findFirst.mockResolvedValue({
      companyId: 'company-1',
      role: 'OWNER',
      company: { id: 'company-1', name: 'Demo Market Sh.p.k' },
    });
  });

  it('is identified by `sub`, not by the email in the token', async () => {
    await signInWithOAuth(profile);

    expect(db.oAuthAccount.findUnique).toHaveBeenCalledWith({
      where: {
        provider_providerAccountId: { provider: 'google', providerAccountId: 'google-sub-1' },
      },
      include: { user: true },
    });
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('refreshes the name and avatar — Google is the source of truth for both', async () => {
    await signInWithOAuth(profile);

    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        name: 'Arta Krasniqi',
        imageUrl: 'https://images.test/arta.png',
        emailVerifiedAt: verifiedAt,
      },
    });
  });

  it('returns the membership the request will be scoped to', async () => {
    await expect(signInWithOAuth(profile)).resolves.toEqual({
      userId: 'user-1',
      email: 'arta@example.test',
      name: 'Arta Krasniqi',
      imageUrl: 'https://images.test/arta.png',
      companyId: 'company-1',
      companyName: 'Demo Market Sh.p.k',
      role: 'OWNER',
    });
    expect(db.company.create).not.toHaveBeenCalled();
  });
});

describe('signInWithOAuth — a first sign-in for a verified email that already exists', () => {
  beforeEach(() => {
    db.user.findUnique.mockResolvedValue({
      id: 'user-9',
      email: 'arta@example.test',
      name: 'Arta',
      imageUrl: null,
      emailVerifiedAt: verifiedAt,
    });
    db.user.update.mockResolvedValue({
      id: 'user-9',
      email: 'arta@example.test',
      name: 'Arta Krasniqi',
      imageUrl: 'https://images.test/arta.png',
    });
    db.membership.findFirst.mockResolvedValue({
      companyId: 'company-9',
      role: 'OWNER',
      company: { id: 'company-9', name: 'Arta' },
    });
  });

  it('links the provider account to the existing user instead of creating a second one', async () => {
    const identity = await signInWithOAuth(profile);

    expect(identity.userId).toBe('user-9');
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.oAuthAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ userId: 'user-9' }) }),
    );
  });

  it('never rewrites the email: it is the identity the row was created with', async () => {
    await signInWithOAuth(profile);

    const data = db.user.update.mock.calls[0]?.[0]?.data as Record<string, unknown>;

    expect(data).not.toHaveProperty('email');
  });

  it('keeps the original verification timestamp rather than moving it forward', async () => {
    await signInWithOAuth(profile);

    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ emailVerifiedAt: verifiedAt }) }),
    );
  });
});

describe('signInWithOAuth — an unverified claim on an existing email', () => {
  beforeEach(() => {
    db.user.findUnique.mockResolvedValue({
      id: 'user-9',
      email: 'arta@example.test',
      name: 'Arta',
      imageUrl: null,
      emailVerifiedAt: verifiedAt,
    });
  });

  it('is refused with PERMISSION_DENIED: linking on an unverified claim is account takeover', async () => {
    await expect(signInWithOAuth({ ...profile, emailVerified: false })).rejects.toMatchObject({
      code: DomainErrorCode.PERMISSION_DENIED,
    });
  });

  it('writes nothing at all — not the link, not the profile, not a company', async () => {
    await expect(signInWithOAuth({ ...profile, emailVerified: false })).rejects.toThrow();

    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.oAuthAccount.upsert).not.toHaveBeenCalled();
    expect(db.membership.findFirst).not.toHaveBeenCalled();
    expect(db.company.create).not.toHaveBeenCalled();
  });
});

describe('signInWithOAuth — a person nobody has seen before', () => {
  it('provisions a company with the Kosovo defaults and makes them its owner', async () => {
    db.user.create.mockResolvedValue({
      id: 'user-new',
      email: 'arta@example.test',
      name: 'Arta Krasniqi',
      imageUrl: 'https://images.test/arta.png',
    });
    db.company.create.mockResolvedValue({ id: 'company-new', name: 'Arta Krasniqi' });

    const identity = await signInWithOAuth(profile);

    expect(identity).toMatchObject({
      userId: 'user-new',
      companyId: 'company-new',
      companyName: 'Arta Krasniqi',
      role: 'OWNER',
    });
    expect(db.membership.create).toHaveBeenCalledWith({
      data: { userId: 'user-new', companyId: 'company-new', role: 'OWNER' },
    });
  });

  it('creates the company with a VAT table, not an empty one', async () => {
    db.user.create.mockResolvedValue({
      id: 'user-new',
      email: 'arta@example.test',
      name: 'Arta Krasniqi',
      imageUrl: null,
    });
    db.company.create.mockResolvedValue({ id: 'company-new', name: 'Arta Krasniqi' });

    await signInWithOAuth(profile);

    const created = db.company.create.mock.calls[0]?.[0] as {
      data: {
        name: string;
        countryCode: string;
        currency: string;
        taxRates: { create: readonly { code: string; isDefault: boolean }[] };
      };
    };

    expect(created.data).toMatchObject({
      name: 'Arta Krasniqi',
      countryCode: 'XK',
      currency: 'EUR',
    });
    expect(created.data.taxRates.create).toHaveLength(5);
    expect(created.data.taxRates.create.filter((rate) => rate.isDefault)).toEqual([
      expect.objectContaining({ code: 'vat-18' }),
    ]);
  });

  it('adopts a company that has no members instead of provisioning a second, empty one', async () => {
    // The seeded MVP tenant: its captured invoices are exactly what the first person to sign in
    // expects to find, so creating a fresh company would hide them behind an empty account.
    db.user.create.mockResolvedValue({
      id: 'user-new',
      email: 'arta@example.test',
      name: 'Arta Krasniqi',
      imageUrl: null,
    });
    db.company.findFirst.mockResolvedValue({ id: 'company-seed', name: 'Demo Market Sh.p.k' });

    const identity = await signInWithOAuth(profile);

    expect(db.company.create).not.toHaveBeenCalled();
    expect(identity).toMatchObject({
      companyId: 'company-seed',
      companyName: 'Demo Market Sh.p.k',
    });
    expect(db.membership.create).toHaveBeenCalledWith({
      data: { userId: 'user-new', companyId: 'company-seed', role: 'OWNER' },
    });
  });

  it('looks for the oldest unowned company, so two member-less tenants resolve deterministically', async () => {
    db.user.create.mockResolvedValue({
      id: 'user-new',
      email: 'arta@example.test',
      name: null,
      imageUrl: null,
    });
    db.company.create.mockResolvedValue({ id: 'company-new', name: 'arta' });

    await signInWithOAuth(profile);

    expect(db.company.findFirst).toHaveBeenCalledWith({
      where: { memberships: { none: {} } },
      orderBy: { createdAt: 'asc' },
    });
    expect(db.membership.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-new' },
      orderBy: { createdAt: 'asc' },
      include: { company: true },
    });
  });

  it('records a verification date only when the provider actually verified the address', async () => {
    db.user.create.mockResolvedValue({
      id: 'user-new',
      email: 'arta@example.test',
      name: null,
      imageUrl: null,
    });
    db.company.create.mockResolvedValue({ id: 'company-new', name: 'arta' });

    await signInWithOAuth({ ...profile, emailVerified: false });

    expect(db.user.create).toHaveBeenCalledWith({
      data: {
        email: 'arta@example.test',
        name: 'Arta Krasniqi',
        imageUrl: 'https://images.test/arta.png',
        emailVerifiedAt: null,
      },
    });
  });
});

describe('listMembershipsForUser', () => {
  it('returns every company the person may act for, oldest first', async () => {
    db.membership.findMany.mockResolvedValue([
      {
        companyId: 'company-1',
        role: 'OWNER',
        company: { id: 'company-1', name: 'Demo Market Sh.p.k' },
      },
      { companyId: 'company-2', role: 'ACCOUNTANT', company: { id: 'company-2', name: 'Arta' } },
    ]);

    await expect(listMembershipsForUser('user-1')).resolves.toEqual([
      { companyId: 'company-1', companyName: 'Demo Market Sh.p.k', role: 'OWNER' },
      { companyId: 'company-2', companyName: 'Arta', role: 'ACCOUNTANT' },
    ]);
    expect(db.membership.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'asc' },
      include: { company: { select: { id: true, name: true } } },
    });
  });

  it('returns nothing for a user who belongs nowhere, instead of inventing a tenant', async () => {
    db.membership.findMany.mockResolvedValue([]);

    await expect(listMembershipsForUser('user-1')).resolves.toEqual([]);
  });
});
