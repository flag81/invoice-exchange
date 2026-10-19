/**
 * The home screen: one action, and an honest message when the app cannot act yet.
 *
 * The page is a server component so the readiness question is answered *before* anything renders: either
 * the capture flow, or the exact commands that stand between the operator and a working app. Rendering a
 * camera button that fails on every press would be the worst of both worlds.
 */

import type { Metadata } from 'next';

import { AccountBar } from '@/components/AccountBar';
import { CaptureFlow } from '@/components/CaptureFlow';
import { SetupNotice } from '@/components/SetupNotice';
import { APP_VERSION } from '@/lib/app-meta';
import { sq } from '@/lib/copy/sq';
import { describeReadiness, describeTenant } from '@/server/readiness';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Kap një faturë',
};

export default async function CapturePage() {
  const readiness = await describeReadiness('/');

  return (
    <main>
      {readiness.ready ? (
        <AccountBar
          companyName={readiness.actor.tenant.companyName}
          email={readiness.actor.email}
        />
      ) : null}

      <span className="badge">{sq.home.badge}</span>
      <h1>{sq.home.title}</h1>
      <p className="muted">{sq.home.intro(sq.app.name)}</p>

      {readiness.ready ? (
        <>
          <p className="muted footnote">{describeTenant(readiness.actor.tenant)}</p>
          <CaptureFlow />
        </>
      ) : (
        <SetupNotice message={readiness.message} />
      )}

      <p className="footnote">
        {sq.common.version} <code>{APP_VERSION}</code> ·{' '}
        <a href="/invoices">{sq.common.allInvoices}</a> · <a href="/api/health">/api/health</a> ·{' '}
        <a href="/api/ready">/api/ready</a>
      </p>
    </main>
  );
}
