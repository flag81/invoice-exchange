import { describe, expect, it } from 'vitest';

import {
  EXCHANGE_STATUSES,
  ExchangeStatus,
  InvoiceStatus,
  isExchangeStatus,
  isInvoiceStatus,
  isTerminalExchangeStatus,
} from '../index';

const FINAL: readonly ExchangeStatus[] = [
  ExchangeStatus.ACCEPTED,
  ExchangeStatus.REJECTED,
  ExchangeStatus.CANCELLED,
];

describe('ExchangeStatus', () => {
  it('is the seven statuses the exchange track uses', () => {
    expect(EXCHANGE_STATUSES).toEqual([
      'PENDING',
      'SENT',
      'VIEWED',
      'ACCEPTED',
      'DISPUTED',
      'REJECTED',
      'CANCELLED',
    ]);

    for (const status of EXCHANGE_STATUSES) {
      expect(isExchangeStatus(status)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    for (const value of ['pending', 'DELIVERED', 'SENT ', '', null, undefined, 1, []]) {
      expect(isExchangeStatus(value)).toBe(false);
    }
  });

  it('knows the three final statuses, and a dispute is not one of them', () => {
    for (const status of EXCHANGE_STATUSES) {
      expect(isTerminalExchangeStatus(status)).toBe(FINAL.includes(status));
    }

    expect(isTerminalExchangeStatus(ExchangeStatus.DISPUTED)).toBe(false);
    expect(isTerminalExchangeStatus(ExchangeStatus.VIEWED)).toBe(false);
  });

  it('keeps its own words where the two tracks differ — PENDING and VIEWED', () => {
    expect(isExchangeStatus(InvoiceStatus.DRAFT)).toBe(false);
    expect(isExchangeStatus(InvoiceStatus.DELIVERED)).toBe(false);
    expect(isInvoiceStatus(ExchangeStatus.PENDING)).toBe(false);
    expect(isInvoiceStatus(ExchangeStatus.VIEWED)).toBe(false);
  });
});
