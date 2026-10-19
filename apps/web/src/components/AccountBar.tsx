/**
 * The signed-in strip at the top of every page: who you are, and the way out.
 *
 * Presentational on purpose — it takes the email as a prop rather than reading the session, because the
 * page has already done that (`describeReadiness`) and asking twice would be a second database round trip
 * for a string. It lives under `src/components` but is a *server* component (no `'use client'`): the only
 * interaction is a form post, which needs no JavaScript.
 *
 * Signing out is a `POST` because it changes state; the route answers with a `303` to `/signin`, so this
 * form works with scripts disabled and cannot be triggered by an `<img>` on another site.
 */

import { sq } from '@/lib/copy/sq';

export type AccountBarProps = {
  readonly email: string;
  readonly companyName: string;
};

export function AccountBar({ email, companyName }: AccountBarProps) {
  return (
    <div className="account-bar">
      <span className="muted">{sq.auth.signedInAs(email)}</span>
      <span className="muted" aria-hidden="true">
        ·
      </span>
      <span className="muted">{companyName}</span>
      <form action="/api/auth/logout" method="post">
        <button className="link-button" type="submit">
          {sq.auth.signOut}
        </button>
      </form>
    </div>
  );
}
