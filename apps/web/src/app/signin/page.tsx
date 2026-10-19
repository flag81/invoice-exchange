/**
 * `/signin` — one button, and an honest reason when the button cannot exist.
 *
 * Everything here is a server component: there is no client-side auth SDK, no token in JavaScript, and no
 * loading state. The button is a plain form post to `/api/auth/oauth/google/start`, which answers with a
 * `303` to Google, so the whole flow works with scripts disabled.
 *
 * Three states, and each one is a real situation rather than an edge case:
 *
 *   * **already signed in** — the session in the cookie is enough; send the person where they were going;
 *   * **not configured** — a fresh clone with no `GOOGLE_CLIENT_ID`; say which two variables are missing
 *     instead of rendering a button that fails on press;
 *   * **a failed attempt** — `?error=CODE` from the callback, turned into a sentence by `authErrorLabel`.
 *     The code is ours, never Google's prose.
 */

import { DatabaseUnavailableError } from '@einv/db';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SetupNotice } from '@/components/SetupNotice';
import { authErrorLabel, sq } from '@/lib/copy/sq';
import { GOOGLE_CALLBACK_PATH } from '@/server/auth/providers/google';
import { DEFAULT_RETURN_TO, safeReturnTo } from '@/server/auth/return-to';
import { currentActor, signInIsConfigured } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Hyr',
};

type PageProps = {
  readonly searchParams: Promise<{
    readonly next?: string;
    readonly error?: string;
  }>;
};

export default async function SignInPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const next = safeReturnTo(params.next);

  let actor;

  try {
    actor = await currentActor();
  } catch (error) {
    // The database is unreachable, so there is nothing to sign in *to*. Say that, rather than showing a
    // button whose callback would fail on the next screen.
    if (error instanceof DatabaseUnavailableError) {
      return (
        <main>
          <h1>{sq.auth.title}</h1>
          <SetupNotice message={error.message} />
        </main>
      );
    }

    throw error;
  }

  if (actor !== null) {
    redirect(next);
  }

  const errorLabel = authErrorLabel(params.error);
  const configured = signInIsConfigured();

  return (
    <main>
      <h1>{sq.auth.title}</h1>
      <p className="muted">{sq.auth.intro}</p>

      {errorLabel === null ? null : (
        <div className="card alert-card" role="alert">
          <h2>{sq.auth.errorTitle}</h2>
          <p className="alert">{errorLabel}</p>
        </div>
      )}

      {configured ? (
        <>
          <form action="/api/auth/oauth/google/start" method="post">
            <input type="hidden" name="next" value={next} />
            <button className="primary" type="submit">
              {sq.auth.google}
            </button>
          </form>
          <p className="muted footnote">{sq.auth.footnote}</p>
        </>
      ) : (
        <div className="card alert-card">
          <h2>{sq.auth.notConfiguredTitle}</h2>
          <p className="muted">{sq.auth.notConfiguredBody}</p>
          <p className="muted footnote">
            Redirect URI: <code>{GOOGLE_CALLBACK_PATH}</code>
          </p>
        </div>
      )}

      {next === DEFAULT_RETURN_TO ? null : (
        <p className="footnote">
          <a href={next}>Kthehu aty ku ishe</a>
        </p>
      )}
    </main>
  );
}
