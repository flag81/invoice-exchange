/**
 * How the two lifecycles line up (§4.5).
 *
 * `Invoice.status` and `InvoiceExchange.status` are separate because they answer different questions, but
 * they describe the same invoice, so the relationship between them has to be written down somewhere
 * exact. This is that place: one total mapping, checked by the type system (a missing status would not
 * compile) and pinned by tests.
 *
 * Reading the table: an invoice that exists but has not been handed over is `PENDING` on the exchange
 * (nobody has been asked anything yet); `SENT` is the buyer's inbox; `DELIVERED` means the buyer has
 * looked; `PAID` is still `ACCEPTED` on the exchange side, because from the buyer's point of view the
 * decision was the acceptance and the payment is the supplier's bookkeeping.
 */

import { InvoiceStatus } from '../invoicing/status';
import { ExchangeStatus } from './status';

const PROJECTION: Readonly<Record<InvoiceStatus, ExchangeStatus>> = {
  [InvoiceStatus.DRAFT]: ExchangeStatus.PENDING,
  [InvoiceStatus.ISSUED]: ExchangeStatus.PENDING,
  [InvoiceStatus.SENT]: ExchangeStatus.SENT,
  [InvoiceStatus.DELIVERED]: ExchangeStatus.VIEWED,
  [InvoiceStatus.ACCEPTED]: ExchangeStatus.ACCEPTED,
  [InvoiceStatus.DISPUTED]: ExchangeStatus.DISPUTED,
  [InvoiceStatus.REJECTED]: ExchangeStatus.REJECTED,
  [InvoiceStatus.PAID]: ExchangeStatus.ACCEPTED,
  [InvoiceStatus.CANCELLED]: ExchangeStatus.CANCELLED,
};

/**
 * The exchange status that corresponds to an invoice status.
 *
 * It is deliberately *not* invertible: `ACCEPTED` and `PAID` both project to `ACCEPTED`, and `DRAFT` and
 * `ISSUED` both project to `PENDING`, because the exchange only records what the counterparty was asked
 * and answered. Callers that need the reverse are asking about the invoice, not the interaction.
 */
export function exchangeStatusForInvoice(status: InvoiceStatus): ExchangeStatus {
  return PROJECTION[status];
}
