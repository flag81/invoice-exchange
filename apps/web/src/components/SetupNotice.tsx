/**
 * The setup card: what is missing, and the three commands that fix it.
 *
 * A first-run screen that says "error" teaches nothing. This one says which command is missing, in the
 * order they must be run, and why the app needs them — because the reason the capture flow cannot work
 * without a database is not obvious (it is not storage of the image: it is the company's currency and its
 * own VAT rate table, which is what turns a photograph into exact numbers).
 */

import { sq } from '@/lib/copy/sq';

export type SetupNoticeProps = {
  readonly message: string;
};

export function SetupNotice({ message }: SetupNoticeProps) {
  return (
    <div className="card alert-card">
      <h2>{sq.setup.title}</h2>
      <p className="alert">{message}</p>
      <ol>
        <li>
          <code>pnpm db:dev</code> — nis një PostgreSQL lokal, ose vendos një{' '}
          <code>DATABASE_URL</code> të hostuar në <code>.env</code>
        </li>
        <li>
          <code>pnpm db:migrate</code> — krijo tabelat
        </li>
        <li>
          <code>pnpm db:seed</code> — kompania demo dhe normat e TVSH-së së Kosovës
        </li>
      </ol>
      <p className="muted footnote">{sq.setup.then}</p>
    </div>
  );
}
