import { INVOICE_SEARCH_MAX_LENGTH, listInvoices, normaliseInvoiceSearch } from '@einv/db';
import { formatMoney, isCurrencyCode } from '@einv/shared';
import type { Metadata } from 'next';

import { AccountBar } from '@/components/AccountBar';
import { SetupNotice } from '@/components/SetupNotice';
import { sq, statusLabel } from '@/lib/copy/sq';
import { formatDateSq } from '@/lib/format-sq';
import { describeReadiness } from '@/server/readiness';

/**
 * The list: newest first, one card per captured invoice.
 *
 * Money is rendered with `formatMoney`, which groups the digits itself rather than calling `Intl` — an
 * amount that was computed exactly must not be handed to a formatter that rounds a binary double.
 *
 * The search box is a plain `GET` form (`/invoices?q=…`), so a filtered list is a URL a person can
 * reload or send to a colleague, and it works before any script has loaded. *What* a word matches —
 * the supplier's name or a line's description — is decided in `@einv/db`, not here.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Faturat',
};

function money(minorUnits: string, currency: string, unit?: string): string {
  const amount = BigInt(minorUnits);

  return formatMoney(
    amount,
    isCurrencyCode(currency) ? currency : 'EUR',
    unit === undefined ? {} : { unit },
  );
}

type PageProps = {
  readonly searchParams: Promise<{
    /** The search box: a supplier's name, or the description of something on a line. */
    readonly q?: string;
  }>;
};

export default async function InvoicesPage({ searchParams }: PageProps) {
  const readiness = await describeReadiness('/invoices');

  if (!readiness.ready) {
    return (
      <main>
        <h1>{sq.invoices.title}</h1>
        <SetupNotice message={readiness.message} />
      </main>
    );
  }

  const { tenant } = readiness.actor;
  const query = normaliseInvoiceSearch((await searchParams).q);
  const invoices = await listInvoices(tenant.companyId, { search: query });

  return (
    <main>
      <AccountBar companyName={tenant.companyName} email={readiness.actor.email} />
      <h1>{sq.invoices.heading}</h1>

      <form action="/invoices" method="get" role="search" className="search-form">
        <div className="field">
          <label htmlFor="invoice-search">{sq.invoices.searchLabel}</label>
          <input
            id="invoice-search"
            type="search"
            name="q"
            defaultValue={query}
            placeholder={sq.invoices.searchPlaceholder}
            maxLength={INVOICE_SEARCH_MAX_LENGTH}
            autoComplete="off"
          />
        </div>
        <div className="search-actions">
          <button className="primary" type="submit">
            {sq.invoices.searchAction}
          </button>
          {query === '' ? null : <a href="/invoices">{sq.invoices.searchClear}</a>}
        </div>
      </form>

      <p className="muted footnote">
        {query === ''
          ? sq.invoices.summary(tenant.companyName, invoices.length)
          : sq.invoices.searchSummary(query, invoices.length)}{' '}
        · <a href="/">{sq.common.captureAnother}</a>
      </p>

      {invoices.length === 0 ? (
        <div className="card">
          <h2>{query === '' ? sq.invoices.empty : sq.invoices.noMatches}</h2>
          <p className="muted">
            {query === '' ? sq.invoices.emptyHint : sq.invoices.noMatchesHint(query)}
          </p>
          {query === '' ? null : (
            <p className="footnote">
              <a href="/invoices">{sq.invoices.searchClear}</a>
            </p>
          )}
        </div>
      ) : (
        <ul className="invoice-list">
          {invoices.map((invoice) => (
            <li className="card invoice-card" key={invoice.id}>
              <div className="invoice-card-main">
                <a href={`/invoices/${invoice.id}`}>
                  <strong>{invoice.supplierName}</strong>
                </a>
                <span className="muted">
                  {invoice.invoiceNumber ?? sq.common.noNumber} ·{' '}
                  {invoice.issueDate === null ? sq.common.noDate : formatDateSq(invoice.issueDate)}{' '}
                  · {sq.invoices.lineCount(invoice.lineCount)}
                </span>
              </div>
              <div className="invoice-card-amount">
                <strong>{money(invoice.totalMinor, invoice.currency)}</strong>
                <span className="status">{statusLabel(invoice.status)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="footnote">
        <a href="/">{sq.common.captureInvoice}</a>
      </p>
    </main>
  );
}
