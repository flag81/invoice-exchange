/**
 * `Invoice.status` — the supplier's own view of an invoice, from draft to paid (§4.5).
 *
 * This is deliberately not the same thing as `InvoiceExchange.status`: a PDF-only invoice has a legal
 * lifecycle even when nobody clicked anything, and the buyer side is multi-party. This track answers
 * "is this document valid and settled"; the exchange track answers "what did the other side do".
 *
 * The values match the diagram in §4.5 one-for-one, and the transitions between them are a table in
 * `transitions.ts` rather than `if` statements scattered through the app.
 */

export const InvoiceStatus = {
  /** Editable. The only status in which a line, a price or a date may change. */
  DRAFT: 'DRAFT',
  /** Numbered and locked; corrections now need a new version or a credit note. */
  ISSUED: 'ISSUED',
  /** Handed to the buyer (portal notification, email, download link). */
  SENT: 'SENT',
  /** The buyer has seen it. */
  DELIVERED: 'DELIVERED',
  /** The buyer accepted it; payment is expected. */
  ACCEPTED: 'ACCEPTED',
  /** The buyer disputed it; a reason is mandatory and the invoice needs resolving. */
  DISPUTED: 'DISPUTED',
  /** The dispute ended in a refusal; a credit note or a corrected invoice follows. */
  REJECTED: 'REJECTED',
  /** The supplier saw the money arrive. */
  PAID: 'PAID',
  /** Deliberately voided before the buyer acted. */
  CANCELLED: 'CANCELLED',
} as const;

export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const INVOICE_STATUSES: readonly InvoiceStatus[] = Object.values(InvoiceStatus);

/** Statuses a document never leaves: `PAID`, `REJECTED` and `CANCELLED` are final. */
const TERMINAL_INVOICE_STATUSES: readonly InvoiceStatus[] = [
  InvoiceStatus.PAID,
  InvoiceStatus.REJECTED,
  InvoiceStatus.CANCELLED,
];

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return typeof value === 'string' && (INVOICE_STATUSES as readonly string[]).includes(value);
}

export function isInvoiceDraft(status: InvoiceStatus): boolean {
  return status === InvoiceStatus.DRAFT;
}

/**
 * Draft is the only editable state (§4.5); everything else is locked. `isInvoiceLocked` is the same
 * predicate as the `lockedAt !== null` half of invariant 3 in §4.3, which is the point: one rule, one
 * function, so the database constraint and the TypeScript guard cannot drift apart.
 */
export function isInvoiceLocked(status: InvoiceStatus): boolean {
  return !isInvoiceDraft(status);
}

export function isTerminalInvoiceStatus(status: InvoiceStatus): boolean {
  return TERMINAL_INVOICE_STATUSES.includes(status);
}
