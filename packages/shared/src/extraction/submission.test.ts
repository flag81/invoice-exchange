import { describe, expect, it } from 'vitest';

import { CurrencyCode } from '../currency';
import { TaxCategory, type TaxRate } from '../tax';
import { normaliseInvoiceSubmission } from './submission';
import { DraftProblemCode, type NormalisedDraft } from './types';

const rates: readonly TaxRate[] = [
  { id: 'vat-18', name: 'VAT 18%', category: TaxCategory.STANDARD, ratePercent: '18' },
  { id: 'vat-8', name: 'VAT 8%', category: TaxCategory.REDUCED, ratePercent: '8' },
];

const options = { defaultCurrency: CurrencyCode.EUR, taxRates: rates } as const;

/**
 * What the review form posts after a human has checked an extraction: text only, rate chosen by id.
 *
 *   3 × 12,50 = 3750 (18 %) · 2,5 × 4,00 − 1,00 = 900 (8 %) · discount 200
 *   subtotal 4650 · tax 747 · total 5197 = 51,97 EUR
 */
const reviewed = {
  currency: 'EUR',
  supplier: {
    name: 'NPT Kafe Sh.p.k',
    vatNumber: '811234567',
    address: 'Rr. Luan Haradinaj 12, Prishtinë',
    countryCode: 'XK',
  },
  buyer: { name: 'Market i Im', vatNumber: '819999999' },
  invoiceNumber: '2026-0042',
  issueDate: '2026-03-14',
  dueDate: '2026-04-14',
  notes: 'Dorëzuar në magazinë',
  documentDiscount: '2,00',
  lines: [
    { description: 'Kafe 1 kg', quantity: '3', unitPrice: '12,50', taxRateId: 'vat-18' },
    {
      description: 'Uji 1.5 l',
      quantity: '2,5',
      unitPrice: '4,00',
      lineDiscount: '1,00',
      taxRateId: 'vat-8',
    },
  ],
};

function codesOf(draft: NormalisedDraft): readonly string[] {
  return draft.problems.map((problem) => problem.code);
}

describe('normaliseInvoiceSubmission', () => {
  it('recomputes every amount from the text the user typed, never from the client', () => {
    const draft = normaliseInvoiceSubmission(reviewed, options);

    expect(draft.problems).toEqual([]);
    expect(draft.isSaveable).toBe(true);
    expect(draft.supplier.address).toBe('Rr. Luan Haradinaj 12, Prishtinë');
    expect(draft.buyer.name).toBe('Market i Im');
    expect(draft.notes).toBe('Dorëzuar në magazinë');

    expect(draft.lines[0]).toMatchObject({
      position: 1,
      quantity: '3',
      quantityScaled: 30_000n,
      unitPriceMinor: 1250n,
      lineTotalMinor: 3750n,
      taxMinor: 675n,
    });
    expect(draft.lines[1]).toMatchObject({
      quantity: '2.5',
      lineDiscountMinor: 100n,
      lineTotalMinor: 900n,
      taxMinor: 72n,
    });

    expect(draft.totals.subtotalMinor).toBe(4650n);
    expect(draft.totals.lineDiscountMinor).toBe(100n);
    expect(draft.totals.taxMinor).toBe(747n);
    expect(draft.totals.documentDiscountMinor).toBe(200n);
    expect(draft.totals.totalMinor).toBe(5197n);
  });

  it('parses the local formats a keyboard produces', () => {
    const draft = normaliseInvoiceSubmission(
      {
        ...reviewed,
        documentDiscount: '0',
        lines: [
          { description: 'Pajisje', quantity: '2,5', unitPrice: '1.234,56', taxRateId: 'vat-18' },
        ],
      },
      options,
    );

    expect(draft.lines[0]?.quantityScaled).toBe(25_000n);
    expect(draft.lines[0]?.unitPriceMinor).toBe(123_456n);
    expect(draft.lines[0]?.lineTotalMinor).toBe(308_640n);
    expect(draft.problems).toEqual([]);
  });

  it('ignores an amount the client sent as minor units instead of text', () => {
    const draft = normaliseInvoiceSubmission(
      {
        ...reviewed,
        documentDiscount: '0',
        lines: [
          {
            description: 'Pajisje',
            quantity: '1',
            unitPriceMinor: 1,
            taxRateId: 'vat-18',
          },
        ],
      },
      options,
    );

    expect(codesOf(draft)).toEqual([DraftProblemCode.INVALID_UNIT_PRICE]);
    expect(draft.lines[0]?.unitPriceMinor).toBe(0n);
    expect(draft.isSaveable).toBe(false);
  });

  it('refuses a rate id the company does not have, and one that was not sent at all', () => {
    const unknown = normaliseInvoiceSubmission(
      {
        ...reviewed,
        documentDiscount: '0',
        lines: [{ description: 'X', quantity: '1', unitPrice: '1,00', taxRateId: 'nope' }],
      },
      options,
    );
    const missing = normaliseInvoiceSubmission(
      {
        ...reviewed,
        documentDiscount: '0',
        lines: [{ description: 'X', quantity: '1', unitPrice: '1,00' }],
      },
      options,
    );

    expect(codesOf(unknown)).toEqual([DraftProblemCode.INVALID_TAX_RATE]);
    expect(unknown.problems[0]?.message).toContain('nope');
    expect(codesOf(missing)).toEqual([DraftProblemCode.INVALID_TAX_RATE]);
    expect(missing.problems[0]?.message).toContain('nuk ka normë TVSH-je');
    expect(missing.isSaveable).toBe(false);
  });

  it('requires the facts the database will not accept without', () => {
    const draft = normaliseInvoiceSubmission({ lines: [] }, options);

    expect(codesOf(draft)).toEqual([
      DraftProblemCode.CURRENCY_NOT_FOUND,
      DraftProblemCode.MISSING_SUPPLIER_NAME,
      DraftProblemCode.MISSING_INVOICE_NUMBER,
      DraftProblemCode.MISSING_ISSUE_DATE,
      DraftProblemCode.NO_LINES,
    ]);
    expect(draft.isSaveable).toBe(false);
  });

  it('accepts a lower-case currency code and reports one it does not know', () => {
    const lower = normaliseInvoiceSubmission({ ...reviewed, currency: 'eur' }, options);
    const unknown = normaliseInvoiceSubmission({ ...reviewed, currency: 'XBT' }, options);

    expect(lower.currency).toBe(CurrencyCode.EUR);
    expect(lower.problems).toEqual([]);
    expect(codesOf(unknown)).toEqual([DraftProblemCode.CURRENCY_NOT_FOUND]);
  });
});
