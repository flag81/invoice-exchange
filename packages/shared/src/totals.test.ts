import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CurrencyCode,
  DomainErrorCode,
  TaxCategory,
  assertTotalsConsistent,
  computeTotals,
  totalsAreConsistent,
  type InvoiceLineTotalsInput,
  type InvoiceTotals,
  type TaxRate,
} from './index';
import { expectDomainError } from './testing/domain-error';

const EUR = CurrencyCode.EUR;

const vat18: TaxRate = {
  id: 'vat-18',
  name: 'VAT 18%',
  category: TaxCategory.STANDARD,
  ratePercent: '18',
};

const vat8: TaxRate = {
  id: 'vat-8',
  name: 'VAT 8.5%',
  category: TaxCategory.REDUCED,
  ratePercent: '8.5',
};

const zeroRated: TaxRate = {
  id: 'vat-0',
  name: 'Zero rated',
  category: TaxCategory.ZERO,
  ratePercent: '0',
};

/** 3 × 50.00 − 5.00 discount = 145.00 at 18 % → 26.10 */
const lineDiscounted: InvoiceLineTotalsInput = {
  lineId: 'line-1',
  quantity: '3',
  unitPriceMinor: 5000n,
  lineDiscountMinor: 500n,
  taxRate: vat18,
};

/** 2.5 × 12.34 = 30.85 at 18 % → 5.55 (rounded half-up from 5.553) */
const lineFractional: InvoiceLineTotalsInput = {
  lineId: 'line-2',
  quantity: '2.5',
  unitPriceMinor: 1234n,
  taxRate: vat18,
};

describe('computeTotals', () => {
  it('derives every amount of §4.4 from the lines, in one place', () => {
    const totals = computeTotals({
      currency: EUR,
      lines: [lineDiscounted, lineFractional],
      documentDiscountMinor: 585n,
      paymentsMinor: [10000n, 165n],
    });

    expect(totals).toEqual({
      currency: EUR,
      subtotalMinor: 17585n,
      lineDiscountMinor: 500n,
      documentDiscountMinor: 585n,
      taxMinor: 3165n,
      totalMinor: 20165n,
      paidMinor: 10165n,
      payableMinor: 10000n,
      taxSummary: [
        {
          taxRateId: 'vat-18',
          name: 'VAT 18%',
          category: TaxCategory.STANDARD,
          ratePercent: '18',
          baseMinor: 17585n,
          taxMinor: 3165n,
        },
      ],
    });
  });

  it('nets tax per rate and sorts the summary by rate id, so a snapshot is byte-stable', () => {
    const totals = computeTotals({
      currency: EUR,
      lines: [
        { quantity: '1', unitPriceMinor: 10000n, taxRate: vat18 },
        { quantity: '1', unitPriceMinor: 10000n, taxRate: zeroRated },
        { quantity: '1', unitPriceMinor: 10000n, taxRate: vat8 },
        { quantity: '1', unitPriceMinor: 10000n, taxRate: vat18 },
      ],
    });

    expect(totals.subtotalMinor).toBe(40000n);
    expect(totals.taxMinor).toBe(1800n + 0n + 850n + 1800n);
    expect(totals.taxSummary.map((row) => row.taxRateId)).toEqual(['vat-0', 'vat-18', 'vat-8']);
    expect(totals.taxSummary).toEqual([
      {
        taxRateId: 'vat-0',
        name: 'Zero rated',
        category: TaxCategory.ZERO,
        ratePercent: '0',
        baseMinor: 10000n,
        taxMinor: 0n,
      },
      {
        taxRateId: 'vat-18',
        name: 'VAT 18%',
        category: TaxCategory.STANDARD,
        ratePercent: '18',
        baseMinor: 20000n,
        taxMinor: 3600n,
      },
      {
        taxRateId: 'vat-8',
        name: 'VAT 8.5%',
        category: TaxCategory.REDUCED,
        ratePercent: '8.5',
        baseMinor: 10000n,
        taxMinor: 850n,
      },
    ]);
  });

  it('rounds per line, before summing, so the lines on screen add up to the subtotal', () => {
    const half = computeTotals({
      currency: EUR,
      lines: [{ quantity: '0.5', unitPriceMinor: 1n, taxRate: zeroRated }],
    });

    expect(half.subtotalMinor).toBe(1n);

    const three = computeTotals({
      currency: EUR,
      lines: [{ quantity: '3', unitPriceMinor: 1n, taxRate: zeroRated }],
    });

    expect(three.subtotalMinor).toBe(3n);
  });

  it('handles a document with no lines at all, which is what a new draft is', () => {
    const totals = computeTotals({ currency: EUR, lines: [] });

    expect(totals.subtotalMinor).toBe(0n);
    expect(totals.lineDiscountMinor).toBe(0n);
    expect(totals.documentDiscountMinor).toBe(0n);
    expect(totals.taxMinor).toBe(0n);
    expect(totals.totalMinor).toBe(0n);
    expect(totals.paidMinor).toBe(0n);
    expect(totals.payableMinor).toBe(0n);
    expect(totals.taxSummary).toEqual([]);
    expect(totalsAreConsistent(totals)).toBe(true);
  });

  it('treats a discount equal to the subtotal as the boundary case it is', () => {
    const totals = computeTotals({
      currency: EUR,
      lines: [{ quantity: '1', unitPriceMinor: 1000n, taxRate: zeroRated }],
      documentDiscountMinor: 1000n,
    });

    expect(totals.totalMinor).toBe(0n);
    expect(totals.payableMinor).toBe(0n);
  });

  it('leaves a payable that is negative when the buyer overpaid, rather than hiding it', () => {
    const totals = computeTotals({
      currency: EUR,
      lines: [{ quantity: '1', unitPriceMinor: 1000n, taxRate: zeroRated }],
      paymentsMinor: [1500n],
    });

    expect(totals.totalMinor).toBe(1000n);
    expect(totals.payableMinor).toBe(-500n);
  });
});

describe('computeTotals refuses impossible documents', () => {
  it('rejects a line discount larger than the line it discounts', () => {
    const error = expectDomainError(
      () =>
        computeTotals({
          currency: EUR,
          lines: [
            {
              lineId: 'line-1',
              quantity: '1',
              unitPriceMinor: 100n,
              lineDiscountMinor: 101n,
              taxRate: vat18,
            },
          ],
        }),
      DomainErrorCode.INVALID_AMOUNT,
    );

    expect(error.details).toEqual({ lineId: 'line-1', grossMinor: 100n, discountMinor: 101n });
  });

  it('rejects a negative unit price, naming the field', () => {
    const error = expectDomainError(
      () =>
        computeTotals({
          currency: EUR,
          lines: [{ quantity: '1', unitPriceMinor: -1n, taxRate: vat18 }],
        }),
      DomainErrorCode.INVALID_AMOUNT,
    );

    expect(error.details).toEqual({ label: 'unit price', amount: -1n });
  });

  it('rejects a negative line discount', () => {
    expectDomainError(
      () =>
        computeTotals({
          currency: EUR,
          lines: [{ quantity: '1', unitPriceMinor: 100n, lineDiscountMinor: -1n, taxRate: vat18 }],
        }),
      DomainErrorCode.INVALID_AMOUNT,
    );
  });

  it('rejects a negative document discount', () => {
    const error = expectDomainError(
      () => computeTotals({ currency: EUR, lines: [], documentDiscountMinor: -1n }),
      DomainErrorCode.INVALID_AMOUNT,
    );

    expect(error.message).toContain('document discount');
  });

  it('rejects a negative payment, and says which one', () => {
    const error = expectDomainError(
      () => computeTotals({ currency: EUR, lines: [], paymentsMinor: [0n, -1n] }),
      DomainErrorCode.INVALID_AMOUNT,
    );

    expect(error.message).toContain('payment 2');
  });

  it('rejects a document discount larger than the subtotal it discounts', () => {
    expectDomainError(
      () =>
        computeTotals({
          currency: EUR,
          lines: [{ quantity: '1', unitPriceMinor: 100n, taxRate: zeroRated }],
          documentDiscountMinor: 101n,
        }),
      DomainErrorCode.INVALID_AMOUNT,
    );
  });

  it('rejects a quantity that is not a plain decimal', () => {
    expectDomainError(
      () =>
        computeTotals({
          currency: EUR,
          lines: [{ quantity: '2,5', unitPriceMinor: 100n, taxRate: vat18 }],
        }),
      DomainErrorCode.INVALID_QUANTITY,
    );
  });

  it('refuses two different percentages under one rate id', () => {
    const error = expectDomainError(
      () =>
        computeTotals({
          currency: EUR,
          lines: [
            { quantity: '1', unitPriceMinor: 100n, taxRate: vat18 },
            { quantity: '1', unitPriceMinor: 100n, taxRate: { ...vat18, ratePercent: '20' } },
          ],
        }),
      DomainErrorCode.INVALID_RATE,
    );

    expect(error.details).toEqual({
      taxRateId: 'vat-18',
      firstPercent: '18',
      secondPercent: '20',
    });
  });

  it('refuses a "no tax" category that carries a percentage', () => {
    expectDomainError(
      () =>
        computeTotals({
          currency: EUR,
          lines: [
            { quantity: '1', unitPriceMinor: 100n, taxRate: { ...zeroRated, ratePercent: '18' } },
          ],
        }),
      DomainErrorCode.INVALID_RATE,
    );
  });
});

/** Arbitrary documents: whole quantities, so the subtotal is exact and checkable without the domain. */
const lineArb = fc.record({
  unitPriceMinor: fc.bigInt({ min: 0n, max: 10n ** 7n }),
  quantity: fc.integer({ min: 1, max: 5 }).map((quantity) => String(quantity)),
  taxRate: fc.constantFrom(vat18, vat8, zeroRated),
});
const documentArb = fc.array(lineArb, { maxLength: 6 });

const undiscounted = (lines: readonly InvoiceLineTotalsInput[]): InvoiceTotals =>
  computeTotals({ currency: EUR, lines });

describe('totals invariants (the §4.3 invariant 2, as a property)', () => {
  it('is deterministic and always satisfies subtotal + tax − discount = total', () => {
    fc.assert(
      fc.property(documentArb, (lines) => {
        const totals = undiscounted(lines);

        expect(totals).toEqual(undiscounted(lines));
        expect(totalsAreConsistent(totals)).toBe(true);
        expect(() => assertTotalsConsistent(totals)).not.toThrow();
      }),
    );
  });

  it('keeps subtotal equal to Σ unit price × whole quantity, with no rounding anywhere', () => {
    fc.assert(
      fc.property(documentArb, (lines) => {
        const totals = undiscounted(lines);
        const expected = lines.reduce(
          (running, line) => running + line.unitPriceMinor * BigInt(line.quantity),
          0n,
        );

        expect(totals.subtotalMinor).toBe(expected);
        expect(totals.totalMinor).toBe(totals.subtotalMinor + totals.taxMinor);
        expect(totals.payableMinor).toBe(totals.totalMinor);
      }),
    );
  });

  it('charges between nothing and the whole subtotal, because every rate is within 0..100 %', () => {
    fc.assert(
      fc.property(documentArb, (lines) => {
        const totals = undiscounted(lines);

        expect(totals.taxMinor).toBeGreaterThanOrEqual(0n);
        expect(totals.taxMinor).toBeLessThanOrEqual(totals.subtotalMinor);
      }),
    );
  });

  it('drops nothing from the VAT summary: the bases add up to the subtotal, and so do the taxes', () => {
    fc.assert(
      fc.property(documentArb, (lines) => {
        const totals = undiscounted(lines);
        const summaryBase = totals.taxSummary.reduce((running, row) => running + row.baseMinor, 0n);
        const summaryTax = totals.taxSummary.reduce((running, row) => running + row.taxMinor, 0n);

        expect(summaryBase).toBe(totals.subtotalMinor);
        expect(summaryTax).toBe(totals.taxMinor);
      }),
    );
  });

  it('lets a line worth nothing change no amount', () => {
    fc.assert(
      fc.property(documentArb, (lines) => {
        const totals = undiscounted(lines);
        const withEmptyLine = undiscounted([
          ...lines,
          { quantity: '3', unitPriceMinor: 0n, lineDiscountMinor: 0n, taxRate: vat18 },
        ]);

        expect(withEmptyLine.subtotalMinor).toBe(totals.subtotalMinor);
        expect(withEmptyLine.taxMinor).toBe(totals.taxMinor);
        expect(withEmptyLine.totalMinor).toBe(totals.totalMinor);
        expect(withEmptyLine.payableMinor).toBe(totals.payableMinor);
      }),
    );
  });

  it('reduces the total by exactly the document discount', () => {
    fc.assert(
      fc.property(documentArb, (lines) => {
        const totals = undiscounted(lines);
        const discountMinor = totals.subtotalMinor / 3n;
        const discounted = computeTotals({
          currency: EUR,
          lines,
          documentDiscountMinor: discountMinor,
        });

        expect(discounted.subtotalMinor).toBe(totals.subtotalMinor);
        expect(discounted.taxMinor).toBe(totals.taxMinor);
        expect(discounted.totalMinor).toBe(totals.totalMinor - discountMinor);
        expect(discounted.documentDiscountMinor).toBe(discountMinor);
      }),
    );
  });

  it('makes payable zero exactly when the payments add up to the total', () => {
    fc.assert(
      fc.property(documentArb, (lines) => {
        const totals = undiscounted(lines);
        const paid = computeTotals({ currency: EUR, lines, paymentsMinor: [totals.totalMinor] });

        expect(paid.paidMinor).toBe(totals.totalMinor);
        expect(paid.payableMinor).toBe(0n);

        if (totals.totalMinor > 0n) {
          const short = computeTotals({
            currency: EUR,
            lines,
            paymentsMinor: [totals.totalMinor - 1n],
          });

          expect(short.payableMinor).toBe(1n);
        }
      }),
    );
  });
});

describe('totalsAreConsistent and assertTotalsConsistent', () => {
  const totals = computeTotals({ currency: EUR, lines: [lineDiscounted, lineFractional] });

  it('accepts a snapshot that computeTotals produced', () => {
    expect(totalsAreConsistent(totals)).toBe(true);
    expect(() => assertTotalsConsistent(totals)).not.toThrow();
  });

  it('catches a snapshot whose subtotal disagrees with its own tax summary', () => {
    expect(totalsAreConsistent({ ...totals, subtotalMinor: totals.subtotalMinor + 1n })).toBe(
      false,
    );
  });

  it('catches a snapshot whose tax total disagrees with its own tax summary', () => {
    expect(totalsAreConsistent({ ...totals, taxMinor: totals.taxMinor + 1n })).toBe(false);
  });

  it('catches a snapshot where the amounts do not add up', () => {
    expect(totalsAreConsistent({ ...totals, totalMinor: totals.totalMinor + 1n })).toBe(false);
    expect(
      totalsAreConsistent({ ...totals, documentDiscountMinor: totals.documentDiscountMinor + 1n }),
    ).toBe(false);
  });

  it('catches a snapshot that disagrees with its own payments', () => {
    expect(totalsAreConsistent({ ...totals, payableMinor: totals.payableMinor + 1n })).toBe(false);
    expect(totalsAreConsistent({ ...totals, paidMinor: totals.paidMinor + 1n })).toBe(false);
  });

  it('turns a corrupted snapshot into a named failure rather than a wrong number', () => {
    const error = expectDomainError(
      () => assertTotalsConsistent({ ...totals, totalMinor: 0n }),
      DomainErrorCode.TOTALS_MISMATCH,
    );

    expect(error.details).toEqual({
      subtotalMinor: totals.subtotalMinor,
      taxMinor: totals.taxMinor,
      documentDiscountMinor: totals.documentDiscountMinor,
      totalMinor: 0n,
      paidMinor: totals.paidMinor,
      payableMinor: totals.payableMinor,
    });
  });
});
