/**
 * Server-side sessions (`Session` in §4.1, the "sessions table" of §5.3).
 *
 * The database stores only the SHA-256 of the cookie value (`tokenHash`), never the token: a leaked
 * dump or a backup is then a list of unopenable hashes. Everything a request needs — who, and which
 * company — is joined on read, because a session's company can be deleted between two requests and the
 * answer must come from the rows, not from a cached claim in the cookie.
 */

import { isRole, Role } from '@einv/shared';

import { withDatabase } from '../client';

export type CreateSessionInput = {
  readonly userId: string;
  /** Hex SHA-256 of the cookie value. The caller owns the hashing rule (apps/web/src/server/auth). */
  readonly tokenHash: string;
  /** The company the session acts for; must already be a membership of `userId`. */
  readonly companyId: string;
  readonly expiresAt: Date;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
};

/** What a live session resolves to: the actor, plus the tenant every query is scoped to. */
export type ActiveSession = {
  readonly sessionId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string | null;
  readonly imageUrl: string | null;
  readonly companyId: string;
  readonly companyName: string;
  readonly role: Role;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
};

export async function createSession(input: CreateSessionInput): Promise<{ readonly id: string }> {
  return withDatabase(async (client) => {
    const row = await client.session.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        activeCompanyId: input.companyId,
        expiresAt: input.expiresAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
      select: { id: true },
    });

    return { id: row.id };
  });
}

/**
 * The session behind this token hash, or `null` for every way a session can stop being valid:
 * unknown, revoked, expired, its company deleted, or its membership removed.
 *
 * All of those are the same answer on purpose — "sign in again" — and none of them is an error, which
 * is why this returns `null` rather than throwing. The role is re-read from the membership on every
 * request, so a demotion takes effect without waiting for the session to expire; a malformed role
 * fails closed to `VIEWER` instead of being trusted.
 */
export async function findActiveSession(
  tokenHash: string,
  now: Date,
): Promise<ActiveSession | null> {
  return withDatabase(async (client) => {
    const row = await client.session.findUnique({
      where: { tokenHash },
      include: { user: true, activeCompany: true },
    });

    if (row === null || row.revokedAt !== null || row.expiresAt.getTime() <= now.getTime()) {
      return null;
    }

    if (row.activeCompanyId === null || row.activeCompany === null) {
      return null;
    }

    const membership = await client.membership.findUnique({
      where: {
        userId_companyId: { userId: row.userId, companyId: row.activeCompanyId },
      },
      select: { role: true },
    });

    if (membership === null) {
      return null;
    }

    return {
      sessionId: row.id,
      userId: row.userId,
      email: row.user.email,
      name: row.user.name,
      imageUrl: row.user.imageUrl,
      companyId: row.activeCompany.id,
      companyName: row.activeCompany.name,
      role: isRole(membership.role) ? membership.role : Role.VIEWER,
      lastSeenAt: row.lastSeenAt,
      expiresAt: row.expiresAt,
    };
  });
}

/** Records that the session was used. Cheap enough to be lazy: the caller decides how lazy. */
export async function touchSession(sessionId: string, at: Date): Promise<void> {
  await withDatabase((client) =>
    client.session.update({ where: { id: sessionId }, data: { lastSeenAt: at } }),
  );
}

/**
 * Sign-out: mark the row revoked rather than delete it, so "was this token still valid at 14:02?"
 * has an answer later. Revoking an unknown or already-revoked token is a success — signing out twice
 * must not be an error the user has to read.
 */
export async function revokeSessionByTokenHash(tokenHash: string, at: Date): Promise<void> {
  await withDatabase(async (client) => {
    await client.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: at },
    });
  });
}
