import { CurrencyCode, TaxCategory, normaliseInvoiceSubmission } from '@einv/shared';
import { describe, expect, it } from 'vitest';

import { toDraftView, toTaxRateOptions } from './draft-view';

const rates = [
  { id: 'vat-18', name: 'TVSH 18%', category: TaxCategory.STANDARD, ratePercent: '18' },
  { id: 'vat-8', name: 'TVSH 8%', category: TaxCategory.REDUCED, ratePercent: '8' },
] as const;

const draft = normaliseInvoiceSubmission(
  {
    currency: 'EUR',
    supplier: { name: 'NPT Kafe Sh.p.k', vatNumber: '811234567', address: 'Rr. Luan Haradinaj 12' },
    buyer: { name: 'Demo Market Sh.p.k' },
    invoiceNumber: '2026-0042',
    issueDate: '2026-03-14',
    documentDiscount: '2,00',
    lines: [
      { description: 'Kafe 1 kg', quantity: '3', unitPrice: '12,50', taxRateId: 'vat-18' },
      { description: 'Ujë', quantity: '2,5', unitPrice: '4,00', taxRateId: 'vat-8' },
    ],
  },
  { defaultCurrency: CurrencyCode.EUR, taxRates: rates },
);

describe('toDraftView', () => {
  it('renders money and quantities as the strings an input field holds', () => {
    const view = toDraftView(draft);

    expect(view.currency).toBe('EUR');
    expect(view.lines[0]).toMatchObject({
      position: 1,
      description: 'Kafe 1 kg',
      quantity: '3',
      unitPrice: '12.50',
      lineDiscount: '0.00',
      lineTotal: '37.50',
      taxAmount: '6.75',
      taxRatePercent: '18',
      printedLineTotal: null,
    });
    expect(view.lines[1]?.quantity).toBe('2.5');
    expect(view.totals).toMatchObject({
      subtotal: '47.50',
      tax: '7.55',
      total: '53.05',
    });
  });

  it('carries the problems and the verdict, because the screen exists to show them', () => {
    const incomplete = normaliseInvoiceSubmission(
      { supplier: { name: 'X' }, lines: [] },
      { defaultCurrency: CurrencyCode.EUR, taxRates: rates },
    );

    const view = toDraftView(incomplete);

    expect(view.isSaveable).toBe(false);
    expect(view.problems.map((problem) => problem.code)).toContain('NO_LINES');
  });

  it('keeps the per-rate VAT summary a tax authority reads', () => {
    const view = toDraftView(draft);

    expect(view.totals.taxSummary).toHaveLength(2);
    expect(view.totals.taxSummary[0]).toMatchObject({
      taxRateId: 'vat-18',
      ratePercent: '18',
      base: '37.50',
      taxAmount: '6.75',
    });
  });

  it('needs no conversion, so a difference from the tenant default stays visible', () => {
    expect(toDraftView(draft).defaultCurrency).toBe('EUR');
  });
});

describe('toTaxRateOptions', () => {
  it('gives the review screen a label per rate', () => {
    expect(toTaxRateOptions(rates)).toEqual([
      { id: 'vat-18', label: 'TVSH 18% (18%)', ratePercent: '18', category: 'STANDARD' },
      { id: 'vat-8', label: 'TVSH 8% (8%)', ratePercent: '8', category: 'REDUCED' },
    ]);
  });

  it('returns an empty list for a company with no rates rather than inventing one', () => {
    expect(toTaxRateOptions([])).toEqual([]);
  });
});
