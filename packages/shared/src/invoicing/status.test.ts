import { describe, expect, it } from 'vitest';

import {
  INVOICE_STATUSES,
  InvoiceStatus,
  isInvoiceDraft,
  isInvoiceLocked,
  isInvoiceStatus,
  isTerminalInvoiceStatus,
} from '../index';

const FINAL: readonly InvoiceStatus[] = [
  InvoiceStatus.PAID,
  InvoiceStatus.REJECTED,
  InvoiceStatus.CANCELLED,
];

describe('InvoiceStatus', () => {
  it('is exactly the nine statuses of the §4.5 diagram, and the guard accepts each of them', () => {
    expect(INVOICE_STATUSES).toEqual([
      'DRAFT',
      'ISSUED',
      'SENT',
      'DELIVERED',
      'ACCEPTED',
      'DISPUTED',
      'REJECTED',
      'PAID',
      'CANCELLED',
    ]);

    for (const status of INVOICE_STATUSES) {
      expect(isInvoiceStatus(status)).toBe(true);
    }
  });

  it('rejects anything else, including a differently-cased or padded status', () => {
    for (const value of [
      'draft',
      'Paid',
      'PAID ',
      ' ARCHIVED',
      '',
      null,
      undefined,
      42,
      ['SENT'],
    ]) {
      expect(isInvoiceStatus(value)).toBe(false);
    }
  });

  it('treats DRAFT as the only editable state — invariant 3, in one predicate', () => {
    for (const status of INVOICE_STATUSES) {
      expect(isInvoiceDraft(status)).toBe(status === InvoiceStatus.DRAFT);
      expect(isInvoiceLocked(status)).toBe(status !== InvoiceStatus.DRAFT);
      expect(isInvoiceDraft(status)).toBe(!isInvoiceLocked(status));
    }
  });

  it('knows which three statuses are final', () => {
    for (const status of INVOICE_STATUSES) {
      expect(isTerminalInvoiceStatus(status)).toBe(FINAL.includes(status));
    }

    expect(isTerminalInvoiceStatus(InvoiceStatus.ACCEPTED)).toBe(false);
  });
});
