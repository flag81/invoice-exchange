/**
 * "May this page render, and as whom?" — asked once, at the top of every signed-in page.
 *
 * Three outcomes, and the page renders all of them without further thought:
 *
 *   * **ready**, with the actor (user + tenant) — the normal case;
 *   * **not ready**, with the setup advice — the database is missing, and the honest answer is the
 *     command that creates it rather than an empty invoice list;
 *   * **a redirect to `/signin`** — nobody is signed in. `redirect()` throws Next's own control-flow
 *     error, so a page cannot accidentally continue past this line.
 *
 * `describeTenant` is the one-line summary of the company, kept here because it is the same sentence in
 * every page header.
 */

import { DatabaseUnavailableError, type Tenant } from '@einv/db';
import { redirect } from 'next/navigation';

import { count } from '@/lib/copy/sq';

import { signInPath } from './auth/return-to';
import { currentActor, type Actor } from './auth/session';

export type Readiness =
  | { readonly ready: true; readonly actor: Actor }
  | { readonly ready: false; readonly message: string };

/**
 * Resolves the page's actor, or redirects to sign in.
 *
 * The loader is a parameter with a default so both outcomes can be tested without a database or a
 * request: `describeReadiness('/invoices', () => Promise.resolve(actor))`.
 */
export async function describeReadiness(
  returnTo: string,
  load: () => Promise<Actor | null> = currentActor,
): Promise<Readiness> {
  let actor: Actor | null;

  try {
    actor = await load();
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) {
      return { ready: false, message: error.message };
    }

    throw error;
  }

  // Deliberately outside the `try`: `redirect` signals by throwing, and a page must not be able to catch
  // its own way out of the sign-in wall.
  if (actor === null) {
    redirect(signInPath(returnTo));
  }

  return { ready: true, actor };
}

/** A one-line summary of the tenant, for the page header. */
export function describeTenant(tenant: Tenant): string {
  return `${tenant.companyName} · ${tenant.currency} · ${count(
    tenant.taxRates.length,
    'normë TVSH-je',
    'norma TVSH-je',
  )}`;
}
