/**
 * Signing in: who is this person, and which company are they acting for?
 *
 * One function answers both, in one transaction, because the three writes it performs are one fact:
 * *this Google account is this user, and this user belongs to this company*. A half-applied sign-in
 * would be an account nobody can use (an `oauth_accounts` row with no membership) or a tenant nobody
 * owns (a company created for a user that was never linked).
 *
 * The rules, in the order they matter (ADR 0002 §4, ADR 0009):
 *
 *   1. An existing `(provider, provider_account_id)` is the identity — the provider's `sub`, never the
 *      email, because an email can be reassigned and a `sub` cannot.
 *   2. Otherwise the email links the account **only when the provider verified it**. An unverified
 *      claim must not be able to attach itself to somebody else's existing account.
 *   3. Otherwise a new user is created, and gets a company: an existing company with no members is
 *      adopted first (that is the pre-sign-in MVP tenant, whose captured invoices are exactly what the
 *      first person to sign in expects to find), and only then is a new one provisioned.
 *
 * The refresh of `name`/`imageUrl` on every sign-in is deliberate: Google is the source of truth for
 * both, and a stale avatar is a support ticket. The *email* is never rewritten from a claim — it is the
 * identity the user row was created with, and silently rebinding it would move a user's history to a
 * different address.
 */

import { DomainError, DomainErrorCode, Role } from '@einv/shared';

import type { Prisma } from '../generated/prisma/client';
import { withDatabase } from '../client';
import {
  KOSOVO_VAT_RATES,
  PROVISIONED_COUNTRY_CODE,
  PROVISIONED_CURRENCY,
  provisionedCompanyName,
} from './provisioning';

/** What a provider tells us about a person, after its own verification has passed. */
export type OAuthProfile = {
  /** `google` today. Stored as-is; the column is a string for that reason. */
  readonly provider: string;
  /** The provider's stable subject (`sub`). */
  readonly providerAccountId: string;
  /** Trimmed and lower-cased by the caller: `users.email` is unique on exactly this form. */
  readonly email: string;
  /** `true` only when the provider said so (`email_verified`). */
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly imageUrl: string | null;
};

/** The answer to "who is signed in, and as whom". Everything after this is `companyId`-scoped. */
export type SignedInIdentity = {
  readonly userId: string;
  readonly email: string;
  readonly name: string | null;
  readonly imageUrl: string | null;
  readonly companyId: string;
  readonly companyName: string;
  readonly role: string;
};

type Tx = Prisma.TransactionClient;

/** The membership and company a request will be scoped to. */
async function ensureMembership(
  tx: Tx,
  userId: string,
  profile: OAuthProfile,
): Promise<{ readonly companyId: string; readonly companyName: string; readonly role: string }> {
  const existing = await tx.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    include: { company: true },
  });

  if (existing !== null) {
    return {
      companyId: existing.companyId,
      companyName: existing.company.name,
      role: existing.role,
    };
  }

  // A company with no members is a company nobody can reach: adopting the oldest one is how the
  // invoices captured before sign-in existed (the seeded MVP tenant) stay with the first person who
  // signs in, instead of becoming invisible behind a second, empty company.
  const unowned = await tx.company.findFirst({
    where: { memberships: { none: {} } },
    orderBy: { createdAt: 'asc' },
  });

  const company =
    unowned ??
    (await tx.company.create({
      data: {
        name: provisionedCompanyName(profile.name, profile.email),
        countryCode: PROVISIONED_COUNTRY_CODE,
        currency: PROVISIONED_CURRENCY,
        taxRates: {
          create: KOSOVO_VAT_RATES.map((rate) => ({
            code: rate.code,
            name: rate.name,
            category: rate.category,
            ratePercent: rate.ratePercent,
            countryCode: PROVISIONED_COUNTRY_CODE,
            isDefault: rate.isDefault,
          })),
        },
      },
    }));

  const membership = await tx.membership.create({
    data: { userId, companyId: company.id, role: Role.OWNER },
  });

  return { companyId: company.id, companyName: company.name, role: membership.role };
}

/**
 * The user row for this profile, creating it or linking to an existing one by verified email.
 *
 * A `PERMISSION_DENIED` here is the "unverified claim, existing account" case: refusing is the whole
 * point, because linking on an email the provider did not verify is account takeover with extra steps.
 */
async function findOrCreateUser(tx: Tx, profile: OAuthProfile) {
  const byEmail = await tx.user.findUnique({ where: { email: profile.email } });

  if (byEmail !== null) {
    if (!profile.emailVerified) {
      throw new DomainError(
        DomainErrorCode.PERMISSION_DENIED,
        'kjo adresë email është përdorur më parë, por Google nuk e konfirmon atë; hyr me llogarinë që e konfirmon',
      );
    }

    return tx.user.update({
      where: { id: byEmail.id },
      data: {
        name: profile.name ?? byEmail.name,
        imageUrl: profile.imageUrl ?? byEmail.imageUrl,
        emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(),
      },
    });
  }

  return tx.user.create({
    data: {
      email: profile.email,
      name: profile.name,
      imageUrl: profile.imageUrl,
      emailVerifiedAt: profile.emailVerified ? new Date() : null,
    },
  });
}

/**
 * The sign-in use-case: link the account, make sure the person has a company, and return both.
 *
 * `withDatabase` translates "no database" into the one named error the HTTP layer knows how to turn
 * into a 503; everything else — including the permission rule above — propagates as a typed failure.
 */
export async function signInWithOAuth(profile: OAuthProfile): Promise<SignedInIdentity> {
  return withDatabase((client) =>
    client.$transaction(async (tx) => {
      const account = await tx.oAuthAccount.findUnique({
        where: {
          provider_providerAccountId: {
            provider: profile.provider,
            providerAccountId: profile.providerAccountId,
          },
        },
        include: { user: true },
      });

      const user =
        account === null
          ? await findOrCreateUser(tx, profile)
          : await tx.user.update({
              where: { id: account.userId },
              data: {
                name: profile.name ?? account.user.name,
                imageUrl: profile.imageUrl ?? account.user.imageUrl,
                emailVerifiedAt: profile.emailVerified
                  ? (account.user.emailVerifiedAt ?? new Date())
                  : account.user.emailVerifiedAt,
              },
            });

      await tx.oAuthAccount.upsert({
        where: {
          provider_providerAccountId: {
            provider: profile.provider,
            providerAccountId: profile.providerAccountId,
          },
        },
        update: { email: profile.email },
        create: {
          userId: user.id,
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
          email: profile.email,
        },
      });

      const membership = await ensureMembership(tx, user.id, profile);

      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        imageUrl: user.imageUrl,
        ...membership,
      };
    }),
  );
}

/** Every company this person may act for, oldest membership first. Used by `/api/auth/session`. */
export async function listMembershipsForUser(
  userId: string,
): Promise<
  readonly { readonly companyId: string; readonly companyName: string; readonly role: string }[]
> {
  return withDatabase(async (client) => {
    const rows = await client.membership.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: { company: { select: { id: true, name: true } } },
    });

    return rows.map((row) => ({
      companyId: row.companyId,
      companyName: row.company.name,
      role: row.role,
    }));
  });
}
