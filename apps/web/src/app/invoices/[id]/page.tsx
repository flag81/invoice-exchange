import { getInvoiceById } from '@einv/db';
import {
  formatMoney,
  formatQuantity,
  isCurrencyCode,
  parseQuantity,
  type CurrencyCode,
} from '@einv/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AccountBar } from '@/components/AccountBar';
import { SetupNotice } from '@/components/SetupNotice';
import { captureSourceLabel, sq, statusLabel } from '@/lib/copy/sq';
import { formatDateSq } from '@/lib/format-sq';
import { describeReadiness } from '@/server/readiness';

/**
 * One captured invoice, as it is stored.
 *
 * Two things here are load-bearing rather than cosmetic:
 *
 *   * every amount is rendered with `formatMoney` (grouping by string, never `Intl`), so what the screen
 *     shows is the integer that is stored;
 *   * the VAT summary is the stored snapshot, not a recomputation — if the row and its lines ever
 *     disagree, `totalsConsistent` says so on the page instead of being discovered in a tax report.
 */

export const dynamic = 'force-dynamic';

type PageProps = { readonly params: Promise<{ readonly id: string }> };

export const metadata: Metadata = {
  title: 'Fatura',
};

function currencyOf(value: string): CurrencyCode {
  return isCurrencyCode(value) ? value : 'EUR';
}

export default async function InvoiceDetailPage({ params }: PageProps) {
  const { id } = await params;
  const readiness = await describeReadiness(`/invoices/${id}`);

  if (!readiness.ready) {
    return (
      <main>
        <h1>{sq.invoice.title}</h1>
        <SetupNotice message={readiness.message} />
      </main>
    );
  }

  const { tenant } = readiness.actor;
  const invoice = await getInvoiceById(tenant.companyId, id);

  if (invoice === null) {
    notFound();
  }

  const currency = currencyOf(invoice.currency);
  /** Takes the view's minor-unit strings and the tax summary's bigints, and renders both. */
  const money = (minorUnits: string | bigint): string => formatMoney(BigInt(minorUnits), currency);

  return (
    <main>
      <AccountBar companyName={tenant.companyName} email={readiness.actor.email} />
      <span className="badge">{statusLabel(invoice.status)}</span>
      <h1>{invoice.supplier.name}</h1>
      <p className="muted">
        {invoice.invoiceNumber ?? sq.common.noNumber} ·{' '}
        {invoice.issueDate === null
          ? sq.invoice.issueDateUnknown
          : sq.invoice.issuedOn(formatDateSq(invoice.issueDate))}
        {invoice.dueDate === null ? '' : ` · ${sq.invoice.dueOn(formatDateSq(invoice.dueDate))}`} ·{' '}
        {captureSourceLabel(invoice.captureSource)}
      </p>

      {invoice.totalsConsistent ? null : (
        <div className="card alert-card">
          <h2>{sq.invoice.inconsistentTitle}</h2>
          <p className="alert">{sq.invoice.inconsistentBody(invoice.id)}</p>
        </div>
      )}

      <div className="card">
        <h2>{sq.invoice.parties}</h2>
        <dl className="parties">
          <div>
            <dt>{sq.invoice.supplier}</dt>
            <dd>
              {invoice.supplier.name}
              {invoice.supplier.vatNumber === null
                ? ''
                : ` · ${sq.invoice.vatNumber(invoice.supplier.vatNumber)}`}
              {invoice.supplier.address === null ? '' : ` · ${invoice.supplier.address}`}
            </dd>
          </div>
          <div>
            <dt>{sq.invoice.buyer}</dt>
            <dd>{invoice.buyer.name ?? '—'}</dd>
          </div>
        </dl>
      </div>

      <div className="card">
        <h2>{sq.invoice.lines}</h2>
        <table className="lines">
          <thead>
            <tr>
              <th>{sq.invoice.columns.position}</th>
              <th>{sq.invoice.columns.description}</th>
              <th>{sq.invoice.columns.quantity}</th>
              <th>{sq.invoice.columns.unit}</th>
              <th>{sq.invoice.columns.vat}</th>
              <th>{sq.invoice.columns.total}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <td>{line.position}</td>
                <td>{line.description === '' ? '—' : line.description}</td>
                <td>{formatQuantity(parseQuantity(line.quantity))}</td>
                <td>{money(line.unitPriceMinor)}</td>
                <td>{line.taxRatePercent} %</td>
                <td>{money(line.lineTotalMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>{sq.invoice.totals}</h2>
        <dl className="totals">
          <div>
            <dt>{sq.invoice.subtotal}</dt>
            <dd>{money(invoice.totals.subtotalMinor)}</dd>
          </div>
          <div>
            <dt>{sq.invoice.vat}</dt>
            <dd>{money(invoice.totals.taxMinor)}</dd>
          </div>
          <div>
            <dt>{sq.invoice.discount}</dt>
            <dd>{money(invoice.totals.documentDiscountMinor)}</dd>
          </div>
          <div className="total-row">
            <dt>{sq.invoice.total}</dt>
            <dd>{money(invoice.totals.totalMinor)}</dd>
          </div>
        </dl>
        <p className="muted footnote">
          {sq.invoice.vatByRate}:{' '}
          {invoice.totals.taxSummary
            .map((row) =>
              sq.invoice.vatByRateRow(row.ratePercent, money(row.baseMinor), money(row.taxMinor)),
            )
            .join(' · ')}
        </p>
      </div>

      <p className="footnote">
        <a href="/invoices">{sq.common.allInvoices}</a> · <a href="/">{sq.common.captureAnother}</a>{' '}
        · {sq.invoice.storedAs(invoice.id)}
      </p>
    </main>
  );
}
