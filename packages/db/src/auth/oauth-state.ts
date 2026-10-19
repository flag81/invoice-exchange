/**
 * The `state` of an OAuth round trip: the CSRF token, the PKCE verifier, the nonce and where to go back.
 *
 * It is a table rather than a signed cookie because the callback has to be *single use*: consuming the
 * row is one conditional `UPDATE`, so a replayed callback — even one that replays both cookies — finds
 * nothing the second time. A signed cookie cannot express "this has already been used".
 *
 * The row is created when the user presses "Vazhdo me Google" and lives for ten minutes; `expires_at`
 * is compared in SQL, so a process with a skewed clock cannot extend an attempt by believing it is
 * earlier than it is.
 */

import { withDatabase } from '../client';

export type CreateOAuthStateInput = {
  readonly provider: string;
  readonly state: string;
  readonly codeVerifier: string;
  readonly nonce: string;
  /** A path on this site (`/invoices`), already validated by the caller. */
  readonly returnTo: string | null;
  readonly expiresAt: Date;
};

export type ConsumedOAuthState = {
  readonly codeVerifier: string;
  readonly nonce: string | null;
  readonly returnTo: string | null;
};

export async function createOAuthState(input: CreateOAuthStateInput): Promise<void> {
  await withDatabase(async (client) => {
    // Abandoned attempts are swept on the way in: one `DELETE` per sign-in is cheaper than a job, and
    // the alternative — a table that only grows — is how "temporary" tables become permanent.
    await client.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });

    await client.oAuthState.create({
      data: {
        provider: input.provider,
        state: input.state,
        codeVerifier: input.codeVerifier,
        nonce: input.nonce,
        returnTo: input.returnTo,
        expiresAt: input.expiresAt,
      },
    });
  });
}

/**
 * Marks the attempt used and returns what the callback needs, or `null` if it was never issued, already
 * used, or too old.
 *
 * `updateMany` is the atomic part: two callbacks racing on the same `state` produce counts `1` and `0`,
 * so exactly one of them gets to exchange the code.
 */
export async function consumeOAuthState(input: {
  readonly provider: string;
  readonly state: string;
  readonly now: Date;
}): Promise<ConsumedOAuthState | null> {
  return withDatabase(async (client) => {
    const consumed = await client.oAuthState.updateMany({
      where: {
        provider: input.provider,
        state: input.state,
        consumedAt: null,
        expiresAt: { gt: input.now },
      },
      data: { consumedAt: input.now },
    });

    if (consumed.count === 0) {
      return null;
    }

    const row = await client.oAuthState.findUnique({ where: { state: input.state } });

    return row === null
      ? null
      : { codeVerifier: row.codeVerifier, nonce: row.nonce, returnTo: row.returnTo };
  });
}
