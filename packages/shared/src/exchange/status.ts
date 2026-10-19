/**
 * `InvoiceExchange.status` — what the *counterparty interaction* has done, tracked separately from
 * `Invoice.status` (§4.5).
 *
 * The two tracks exist because they answer different questions. The invoice track answers "is this
 * document valid and settled": it is the supplier's own record, it starts before the buyer has ever
 * heard of the invoice, and a supplier may work with a PDF-only invoice that nobody clicks. The exchange
 * track answers "what has the other side seen and decided", it can be moved by any buyer-side user, and
 * it is what the supplier's dashboard watches.
 *
 * The vocabulary is deliberately a **projection** of the invoice track — `VIEWED` is the exchange's word
 * for `DELIVERED`, `PENDING` covers the window in which the invoice exists but the buyer has nothing to
 * react to. `exchangeStatusForInvoice` is that projection written down once, so the two tracks cannot
 * drift into telling different stories about the same invoice.
 */

export const ExchangeStatus = {
  /** Nothing has been asked of the buyer yet: the invoice is a draft or merely issued. */
  PENDING: 'PENDING',
  /** The invoice has been sent and the buyer has not looked at it. */
  SENT: 'SENT',
  /** The buyer has seen it (the invoice track calls this `DELIVERED`). */
  VIEWED: 'VIEWED',
  /** Buyer decision: accepted (the invoice track calls this `ACCEPTED`, and later `PAID`). */
  ACCEPTED: 'ACCEPTED',
  /** Buyer decision: disputed, with a reason. */
  DISPUTED: 'DISPUTED',
  /** Buyer decision: refused, which resolves a dispute. */
  REJECTED: 'REJECTED',
  /** The supplier withdrew the invoice before the buyer decided. */
  CANCELLED: 'CANCELLED',
} as const;

export type ExchangeStatus = (typeof ExchangeStatus)[keyof typeof ExchangeStatus];

export const EXCHANGE_STATUSES: readonly ExchangeStatus[] = Object.values(ExchangeStatus);

/** Statuses the exchange never leaves: the buyer has decided, or the invoice was withdrawn. */
const TERMINAL_EXCHANGE_STATUSES: readonly ExchangeStatus[] = [
  ExchangeStatus.ACCEPTED,
  ExchangeStatus.REJECTED,
  ExchangeStatus.CANCELLED,
];

export function isExchangeStatus(value: unknown): value is ExchangeStatus {
  return typeof value === 'string' && (EXCHANGE_STATUSES as readonly string[]).includes(value);
}

export function isTerminalExchangeStatus(status: ExchangeStatus): boolean {
  return TERMINAL_EXCHANGE_STATUSES.includes(status);
}
