import { describe, expect, it } from 'vitest';

import {
  EXCHANGE_STATUSES,
  ExchangeStatus,
  INVOICE_STATUSES,
  INVOICE_TRANSITIONS,
  InvoiceStatus,
  exchangeStatusForInvoice,
  exchangeTransitionsFrom,
  isExchangeStatus,
} from '../index';

/** Every exchange status reachable from `start` in zero or more legal exchange moves. */
function reachableFrom(start: ExchangeStatus): ReadonlySet<ExchangeStatus> {
  const seen = new Set<ExchangeStatus>([start]);
  const pending: ExchangeStatus[] = [start];

  for (let index = 0; index < pending.length; index += 1) {
    const current = pending[index];

    if (current === undefined) {
      continue;
    }

    for (const row of exchangeTransitionsFrom(current)) {
      if (!seen.has(row.to)) {
        seen.add(row.to);
        pending.push(row.to);
      }
    }
  }

  return seen;
}

describe('exchangeStatusForInvoice', () => {
  it('is one total mapping, read off §4.5 without gaps', () => {
    expect(exchangeStatusForInvoice(InvoiceStatus.DRAFT)).toBe(ExchangeStatus.PENDING);
    expect(exchangeStatusForInvoice(InvoiceStatus.ISSUED)).toBe(ExchangeStatus.PENDING);
    expect(exchangeStatusForInvoice(InvoiceStatus.SENT)).toBe(ExchangeStatus.SENT);
    expect(exchangeStatusForInvoice(InvoiceStatus.DELIVERED)).toBe(ExchangeStatus.VIEWED);
    expect(exchangeStatusForInvoice(InvoiceStatus.ACCEPTED)).toBe(ExchangeStatus.ACCEPTED);
    expect(exchangeStatusForInvoice(InvoiceStatus.DISPUTED)).toBe(ExchangeStatus.DISPUTED);
    expect(exchangeStatusForInvoice(InvoiceStatus.REJECTED)).toBe(ExchangeStatus.REJECTED);
    expect(exchangeStatusForInvoice(InvoiceStatus.PAID)).toBe(ExchangeStatus.ACCEPTED);
    expect(exchangeStatusForInvoice(InvoiceStatus.CANCELLED)).toBe(ExchangeStatus.CANCELLED);
  });

  it('only ever answers with a status the exchange track actually has', () => {
    for (const status of INVOICE_STATUSES) {
      expect(isExchangeStatus(exchangeStatusForInvoice(status))).toBe(true);
    }
  });

  it('reaches every exchange status, so no target is unreachable from the invoice side', () => {
    const image = INVOICE_STATUSES.map(exchangeStatusForInvoice);

    expect([...new Set(image)].sort()).toEqual([...EXCHANGE_STATUSES].sort());
  });

  it('is deliberately not invertible: ACCEPTED and PAID tell the exchange the same story', () => {
    expect(exchangeStatusForInvoice(InvoiceStatus.PAID)).toBe(
      exchangeStatusForInvoice(InvoiceStatus.ACCEPTED),
    );
    expect(exchangeStatusForInvoice(InvoiceStatus.DRAFT)).toBe(
      exchangeStatusForInvoice(InvoiceStatus.ISSUED),
    );

    const image = new Set(INVOICE_STATUSES.map(exchangeStatusForInvoice));

    expect(image.size).toBeLessThan(INVOICE_STATUSES.length);
  });
});

describe('the two tracks cannot drift', () => {
  it('moves the exchange status along with every legal invoice transition', () => {
    for (const row of INVOICE_TRANSITIONS) {
      const before = exchangeStatusForInvoice(row.from);
      const after = exchangeStatusForInvoice(row.to);

      expect(reachableFrom(before).has(after)).toBe(true);
    }
  });

  it('never needs the exchange track to move backwards to keep up', () => {
    for (const status of EXCHANGE_STATUSES) {
      expect(reachableFrom(status).has(ExchangeStatus.PENDING)).toBe(
        status === ExchangeStatus.PENDING,
      );
    }
  });

  it('leaves a paid invoice on the exchange at ACCEPTED, which is a final status there', () => {
    const projected = exchangeStatusForInvoice(InvoiceStatus.PAID);

    expect(projected).toBe(ExchangeStatus.ACCEPTED);
    expect(exchangeTransitionsFrom(projected)).toEqual([]);
  });
});
