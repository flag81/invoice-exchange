import { describe, expect, it } from 'vitest';

import { CurrencyCode } from '../currency';
import { TaxCategory, type TaxRate } from '../tax';
import { totalsAreConsistent } from '../totals';
import { normaliseExtractedInvoice } from './normalise';
import { DraftProblemCode, type DraftProblem, type NormalisedDraft } from './types';

const VAT_18: TaxRate = {
  id: 'vat-18',
  name: 'VAT 18%',
  category: TaxCategory.STANDARD,
  ratePercent: '18',
};

const rates: readonly TaxRate[] = [
  VAT_18,
  { id: 'vat-8', name: 'VAT 8%', category: TaxCategory.REDUCED, ratePercent: '8' },
  { id: 'vat-0', name: 'Zero rated', category: TaxCategory.ZERO, ratePercent: '0' },
  { id: 'vat-exempt', name: 'Exempt', category: TaxCategory.EXEMPT, ratePercent: '0' },
  { id: 'vat-rc', name: 'Reverse charge', category: TaxCategory.REVERSE_CHARGE, ratePercent: '0' },
];

const options = { defaultCurrency: CurrencyCode.EUR, taxRates: rates } as const;

/**
 * A real Kosovo supplier invoice: 3 kg of coffee at 12,50 (18 %) and 2 bottles of water at 0,65
 * (8 %), less a 2,00 document discount.
 *
 *   3750 + 130 = 3880 subtotal · 675 + 10 = 685 tax · 3880 + 685 − 200 = 4365 total = 43,65 EUR
 */
const perfectInvoice = {
  supplier: {
    name: 'NPT Kafe Sh.p.k',
    vatNumber: '811234567',
    address: 'Rr. Luan Haradinaj 12, Prishtinë',
    countryCode: 'XK',
  },
  buyer: { name: 'Market i Im', vatNumber: '819999999' },
  invoiceNumber: '2026-0042',
  issueDate: '14.03.2026',
  dueDate: '2026-04-14',
  currency: 'EUR',
  documentDiscount: '2,00',
  total: '43,65',
  lines: [
    {
      description: 'Kafe 1 kg',
      quantity: '3',
      unitPrice: '12,50',
      taxRatePercent: '18',
      taxCategory: 'STANDARD',
      lineTotal: '37,50',
    },
    {
      description: 'Uji 1.5 l',
      quantity: '2',
      unitPrice: '0,65',
      taxRatePercent: '8',
      taxCategory: 'REDUCED',
      lineTotal: '1,30',
    },
  ],
};

function codesOf(draft: NormalisedDraft): readonly string[] {
  return draft.problems.map((problem: DraftProblem) => problem.code);
}

describe('normaliseExtractedInvoice', () => {
  it('turns a photograph of a Kosovo VAT invoice into exact totals, with nothing to report', () => {
    const draft = normaliseExtractedInvoice(perfectInvoice, options);

    expect(draft.isSaveable).toBe(true);
    expect(draft.problems).toEqual([]);

    expect(draft.currency).toBe(CurrencyCode.EUR);
    expect(draft.defaultCurrency).toBe(CurrencyCode.EUR);
    expect(draft.invoiceNumber).toBe('2026-0042');
    expect(draft.issueDate).toBe('2026-03-14');
    expect(draft.dueDate).toBe('2026-04-14');
    expect(draft.supplier).toEqual({
      name: 'NPT Kafe Sh.p.k',
      vatNumber: '811234567',
      address: 'Rr. Luan Haradinaj 12, Prishtinë',
      countryCode: 'XK',
    });
    expect(draft.buyer.name).toBe('Market i Im');

    expect(draft.lines).toHaveLength(2);
    expect(draft.lines[0]).toMatchObject({
      position: 1,
      description: 'Kafe 1 kg',
      quantity: '3',
      quantityScaled: 30_000n,
      unitPriceMinor: 1250n,
      lineTotalMinor: 3750n,
      taxMinor: 675n,
      printedLineTotalMinor: 3750n,
    });
    expect(draft.lines[0]?.taxRate.id).toBe('vat-18');
    expect(draft.lines[1]?.taxRate.id).toBe('vat-8');
    expect(draft.lines[1]?.taxMinor).toBe(10n);

    expect(draft.totals.subtotalMinor).toBe(3880n);
    expect(draft.totals.taxMinor).toBe(685n);
    expect(draft.totals.documentDiscountMinor).toBe(200n);
    expect(draft.totals.totalMinor).toBe(4365n);
    expect(draft.totals.payableMinor).toBe(4365n);
    expect(draft.totals.taxSummary).toHaveLength(2);
    expect(draft.printedTotalMinor).toBe(4365n);
    expect(totalsAreConsistent(draft.totals)).toBe(true);
  });

  it('rounds each line once, half away from zero, before summing', () => {
    const draft = normaliseExtractedInvoice(
      {
        supplier: { name: 'Bakery', vatNumber: '811234567' },
        invoiceNumber: '1',
        issueDate: '2026-01-01',
        currency: 'EUR',
        lines: [{ description: 'Bread', quantity: '0,5', unitPrice: '0,03', taxRatePercent: '18' }],
      },
      options,
    );

    // 0,5 × 0,03 = 0,015 → half away from zero → 0,02, taxed at 18 % → 0,0036 → 0,00
    expect(draft.lines[0]?.lineTotalMinor).toBe(2n);
    expect(draft.lines[0]?.taxMinor).toBe(0n);
    expect(draft.totals.subtotalMinor).toBe(2n);
  });

  it('flags every fact an invoice cannot be filed without', () => {
    const draft = normaliseExtractedInvoice({}, options);

    expect(draft.isSaveable).toBe(false);
    expect(codesOf(draft)).toEqual([
      DraftProblemCode.CURRENCY_NOT_FOUND,
      DraftProblemCode.MISSING_SUPPLIER_NAME,
      DraftProblemCode.MISSING_INVOICE_NUMBER,
      DraftProblemCode.MISSING_ISSUE_DATE,
      DraftProblemCode.NO_LINES,
    ]);
    expect(
      draft.problems
        .filter((problem) => problem.severity === 'error')
        .map((problem) => problem.code),
    ).toEqual([
      DraftProblemCode.MISSING_SUPPLIER_NAME,
      DraftProblemCode.MISSING_INVOICE_NUMBER,
      DraftProblemCode.MISSING_ISSUE_DATE,
      DraftProblemCode.NO_LINES,
    ]);
  });

  it('treats a missing VAT number as a warning, because plenty of suppliers print none', () => {
    const draft = normaliseExtractedInvoice(
      {
        supplier: { name: 'Furra e Qytetit' },
        invoiceNumber: '7',
        issueDate: '2026-02-01',
        currency: 'EUR',
        lines: [{ description: 'Bukë', quantity: '1', unitPrice: '0,50', taxRatePercent: '0' }],
      },
      options,
    );

    expect(codesOf(draft)).toEqual([DraftProblemCode.MISSING_SUPPLIER_VAT_NUMBER]);
    expect(draft.isSaveable).toBe(true);
  });

  it('reads the date formats the market writes and keeps the day that was printed', () => {
    const dayFirst = normaliseExtractedInvoice(
      { ...perfectInvoice, issueDate: '14/03/2026', dueDate: '14.04.2026' },
      options,
    );
    const iso = normaliseExtractedInvoice(
      { ...perfectInvoice, issueDate: '2026-03-14', dueDate: '2026-04-14' },
      options,
    );

    expect(dayFirst.issueDate).toBe('2026-03-14');
    expect(dayFirst.dueDate).toBe('2026-04-14');
    expect(iso.issueDate).toBe('2026-03-14');
    expect(iso.problems).toEqual([]);
  });

  it('reports an unreadable issue date as an error and an unreadable due date as a warning', () => {
    const draft = normaliseExtractedInvoice(
      { ...perfectInvoice, issueDate: 'I hënë', dueDate: 'pas 30 ditësh' },
      options,
    );

    expect(draft.isSaveable).toBe(false);
    expect(codesOf(draft)).toEqual([
      DraftProblemCode.UNREADABLE_DATE,
      DraftProblemCode.UNREADABLE_DATE,
    ]);
    expect(draft.problems[0]).toMatchObject({ severity: 'error', field: 'issueDate' });
    expect(draft.problems[1]).toMatchObject({ severity: 'warning', field: 'dueDate' });
    expect(draft.issueDate).toBeNull();
    expect(draft.dueDate).toBeNull();
  });

  it("keeps the document's own currency and says so, rather than converting it", () => {
    const draft = normaliseExtractedInvoice({ ...perfectInvoice, currency: 'CHF' }, options);

    expect(draft.currency).toBe(CurrencyCode.CHF);
    expect(draft.defaultCurrency).toBe(CurrencyCode.EUR);
    expect(codesOf(draft)).toEqual([DraftProblemCode.CURRENCY_MISMATCH]);
    expect(draft.problems[0]?.severity).toBe('warning');
    // CHF has the same 2 dp scale, so the same paper yields the same integers.
    expect(draft.totals.totalMinor).toBe(4365n);
  });

  it('assumes the default currency when none is stated or the code is unknown', () => {
    const missing = normaliseExtractedInvoice({ ...perfectInvoice, currency: null }, options);
    const unknown = normaliseExtractedInvoice({ ...perfectInvoice, currency: 'XBT' }, options);

    expect(missing.currency).toBe(CurrencyCode.EUR);
    expect(unknown.currency).toBe(CurrencyCode.EUR);
    expect(codesOf(missing)).toEqual([DraftProblemCode.CURRENCY_NOT_FOUND]);
    expect(unknown.problems[0]?.message).toContain('XBT');
  });

  it('accepts the flat and the nested shapes a provider may return', () => {
    const flat = normaliseExtractedInvoice(
      {
        supplierName: 'NPT Kafe Sh.p.k',
        supplierVatNumber: '811234567',
        invoiceNumber: '2026-0042',
        date: '14.03.2026',
        currency: 'eur',
        lines: [{ description: 'Kafe 1 kg', qty: 3, price: 12.5, vatRate: 18 }],
      },
      options,
    );

    expect(flat.isSaveable).toBe(true);
    expect(flat.currency).toBe(CurrencyCode.EUR);
    expect(flat.issueDate).toBe('2026-03-14');
    expect(flat.lines[0]?.quantity).toBe('3');
    expect(flat.lines[0]?.unitPriceMinor).toBe(1250n);
    expect(flat.lines[0]?.taxRate.id).toBe('vat-18');
  });

  it('reports an answer that is not a document at all', () => {
    for (const raw of [null, undefined, 'hello', 42, [1, 2, 3]]) {
      const draft = normaliseExtractedInvoice(raw, options);

      expect(codesOf(draft)).toContain(DraftProblemCode.NOT_A_DOCUMENT);
      expect(draft.isSaveable).toBe(false);
    }
  });

  it('assumes a quantity of 1 when a line prints none, and says so', () => {
    const draft = normaliseExtractedInvoice(
      {
        supplier: { name: 'Bakery', vatNumber: '811234567' },
        invoiceNumber: '1',
        issueDate: '2026-01-01',
        currency: 'EUR',
        lines: [{ description: 'Bukë', unitPrice: '1,00', taxRatePercent: '18' }],
      },
      options,
    );

    expect(codesOf(draft)).toEqual([DraftProblemCode.QUANTITY_ASSUMED]);
    expect(draft.lines[0]?.quantity).toBe('1');
    expect(draft.lines[0]?.lineTotalMinor).toBe(100n);
    expect(draft.isSaveable).toBe(true);
  });

  it('reports a quantity it cannot read, but keeps the line so the words survive', () => {
    const draft = normaliseExtractedInvoice(
      {
        supplier: { name: 'Bakery', vatNumber: '811234567' },
        invoiceNumber: '1',
        issueDate: '2026-01-01',
        currency: 'EUR',
        lines: [
          { description: 'Bukë', quantity: 'shumë', unitPrice: '1,00', taxRatePercent: '18' },
        ],
      },
      options,
    );

    expect(codesOf(draft)).toEqual([DraftProblemCode.INVALID_QUANTITY]);
    expect(draft.isSaveable).toBe(false);
    expect(draft.lines[0]).toMatchObject({
      description: 'Bukë',
      quantity: '1',
      lineTotalMinor: 100n,
    });
    expect(draft.problems[0]?.field).toBe('lines[0].quantity');
  });

  it('refuses a line with no price instead of inventing one', () => {
    const draft = normaliseExtractedInvoice(
      {
        supplier: { name: 'Bakery', vatNumber: '811234567' },
        invoiceNumber: '1',
        issueDate: '2026-01-01',
        currency: 'EUR',
        lines: [{ description: 'Bukë', quantity: '2', taxRatePercent: '18' }],
      },
      options,
    );

    expect(codesOf(draft)).toEqual([DraftProblemCode.INVALID_UNIT_PRICE]);
    expect(draft.lines[0]).toMatchObject({
      description: 'Bukë',
      unitPriceMinor: 0n,
      lineTotalMinor: 0n,
      taxMinor: 0n,
    });
    expect(draft.isSaveable).toBe(false);
    expect(draft.problems[0]?.message).toContain('shkruaje');
  });

  it('refuses an amount with more places than the currency has', () => {
    const draft = normaliseExtractedInvoice(
      {
        supplier: { name: 'Bakery', vatNumber: '811234567' },
        invoiceNumber: '1',
        issueDate: '2026-01-01',
        currency: 'EUR',
        lines: [{ description: 'Bukë', quantity: '1', unitPrice: '12,345', taxRatePercent: '18' }],
      },
      options,
    );

    expect(codesOf(draft)).toEqual([DraftProblemCode.INVALID_UNIT_PRICE]);
    expect(draft.problems[0]?.message).toContain('12,345');
  });

  it('applies a line discount to that line, and taxes what is left', () => {
    const draft = normaliseExtractedInvoice(
      {
        supplier: { name: 'Bakery', vatNumber: '811234567' },
        invoiceNumber: '1',
        issueDate: '2026-01-01',
        currency: 'EUR',
        lines: [
          {
            description: 'Bukë',
            quantity: '2',
            unitPrice: '10,00',
            lineDiscount: '1,00',
            taxRatePercent: '18',
          },
        ],
      },
      options,
    );

    expect(draft.lines[0]?.lineDiscountMinor).toBe(100n);
    expect(draft.lines[0]?.lineTotalMinor).toBe(1900n);
    expect(draft.lines[0]?.taxMinor).toBe(342n);
    expect(draft.totals.lineDiscountMinor).toBe(100n);
    expect(draft.totals.subtotalMinor).toBe(1900n);
    expect(draft.problems).toEqual([]);
  });

  it('ignores a discount that is not a discount and says so', () => {
    const draft = normaliseExtractedInvoice(
      {
        supplier: { name: 'Bakery', vatNumber: '811234567' },
        invoiceNumber: '1',
        issueDate: '2026-01-01',
        currency: 'EUR',
        lines: [
          {
            description: 'Bukë',
            quantity: '2',
            unitPrice: '10,00',
            lineDiscount: '-1,00',
            taxRatePercent: '18',
          },
        ],
      },
      options,
    );

    expect(codesOf(draft)).toEqual([DraftProblemCode.INVALID_LINE_DISCOUNT]);
    expect(draft.lines[0]?.lineDiscountMinor).toBe(0n);
    expect(draft.isSaveable).toBe(true);
  });

  it('uses the standard rate, with a warning, when the printed percentage matches nothing', () => {
    const draft = normaliseExtractedInvoice(
      {
        supplier: { name: 'Furnitori', vatNumber: '811234567' },
        invoiceNumber: '9',
        issueDate: '2026-01-01',
        currency: 'EUR',
        lines: [
          { description: 'Shërbim', quantity: '1', unitPrice: '100,00', taxRatePercent: '21' },
        ],
      },
      options,
    );

    expect(codesOf(draft)).toEqual([DraftProblemCode.TAX_RATE_ASSUMED]);
    expect(draft.lines[0]?.taxRate.id).toBe('vat-18');
    expect(draft.lines[0]?.taxMinor).toBe(1800n);
    expect(draft.problems[0]?.message).toContain('21');
    expect(draft.isSaveable).toBe(true);
  });

  it('honours an explicit fallback rate when the tenant names one', () => {
    const draft = normaliseExtractedInvoice(
      {
        supplier: { name: 'Furnitori', vatNumber: '811234567' },
        invoiceNumber: '9',
        issueDate: '2026-01-01',
        currency: 'EUR',
        lines: [
          { description: 'Shërbim', quantity: '1', unitPrice: '100,00', taxRatePercent: '21' },
        ],
      },
      {
        defaultCurrency: CurrencyCode.EUR,
        taxRates: [rates[1] as TaxRate, rates[2] as TaxRate],
        fallbackTaxRateId: 'vat-8',
      },
    );

    expect(draft.lines[0]?.taxRate.id).toBe('vat-8');
    expect(codesOf(draft)).toEqual([DraftProblemCode.TAX_RATE_ASSUMED]);
  });

  it('refuses a line it has no rate for, rather than charging nothing', () => {
    const draft = normaliseExtractedInvoice(
      {
        supplier: { name: 'Furnitori', vatNumber: '811234567' },
        invoiceNumber: '9',
        issueDate: '2026-01-01',
        currency: 'EUR',
        lines: [{ description: 'Shërbim', quantity: '1', unitPrice: '100,00' }],
      },
      { defaultCurrency: CurrencyCode.EUR, taxRates: [] },
    );

    expect(codesOf(draft)).toEqual([DraftProblemCode.INVALID_TAX_RATE]);
    expect(draft.lines[0]?.taxRate.id).toBe('unresolved');
    expect(draft.lines[0]?.taxMinor).toBe(0n);
    expect(draft.isSaveable).toBe(false);
  });

  it('matches a line by its printed category when no percentage is printed', () => {
    const zeroRated = normaliseExtractedInvoice(
      {
        supplier: { name: 'Export Sh.p.k', vatNumber: '811234567' },
        invoiceNumber: '3',
        issueDate: '2026-01-01',
        currency: 'EUR',
        lines: [
          { description: 'Eksport', quantity: '1', unitPrice: '100,00', taxCategory: 'zero' },
        ],
      },
      options,
    );
    const reverseCharge = normaliseExtractedInvoice(
      {
        supplier: { name: 'EU Supplier GmbH', vatNumber: '811234567' },
        invoiceNumber: '4',
        issueDate: '2026-01-01',
        currency: 'EUR',
        lines: [
          {
            description: 'Licencë',
            quantity: '1',
            unitPrice: '100,00',
            taxRatePercent: '0',
            taxCategory: 'Reverse Charge',
          },
        ],
      },
      options,
    );

    expect(zeroRated.lines[0]?.taxRate.id).toBe('vat-0');
    expect(zeroRated.lines[0]?.taxMinor).toBe(0n);
    expect(zeroRated.problems).toEqual([]);
    expect(reverseCharge.lines[0]?.taxRate.id).toBe('vat-rc');
    expect(reverseCharge.totals.taxMinor).toBe(0n);
  });

  it('warns when the printed category contradicts the rate table, and the table wins', () => {
    const draft = normaliseExtractedInvoice(
      {
        supplier: { name: 'Furnitori', vatNumber: '811234567' },
        invoiceNumber: '9',
        issueDate: '2026-01-01',
        currency: 'EUR',
        lines: [
          {
            description: 'Shërbim',
            quantity: '1',
            unitPrice: '100,00',
            taxRatePercent: '18',
            taxCategory: 'REDUCED',
          },
        ],
      },
      options,
    );

    expect(codesOf(draft)).toEqual([DraftProblemCode.UNKNOWN_TAX_CATEGORY]);
    expect(draft.lines[0]?.taxRate.id).toBe('vat-18');
    expect(draft.isSaveable).toBe(true);
  });

  it('warns when a printed line total disagrees with the arithmetic', () => {
    const draft = normaliseExtractedInvoice(
      {
        supplier: { name: 'Furnitori', vatNumber: '811234567' },
        invoiceNumber: '9',
        issueDate: '2026-01-01',
        currency: 'EUR',
        lines: [
          {
            description: 'Shërbim',
            quantity: '3',
            unitPrice: '10,00',
            lineTotal: '31,00',
            taxRatePercent: '18',
          },
        ],
      },
      options,
    );

    expect(codesOf(draft)).toEqual([DraftProblemCode.PRINTED_LINE_TOTAL_MISMATCH]);
    expect(draft.lines[0]?.printedLineTotalMinor).toBe(3100n);
    expect(draft.lines[0]?.lineTotalMinor).toBe(3000n);
    expect(draft.problems[0]?.message).toContain('31,00 EUR');
    expect(draft.problems[0]?.message).toContain('30,00 EUR');
    expect(draft.problems[0]?.field).toBe('lines[0].lineTotal');
  });

  it('warns when the printed grand total disagrees with the lines', () => {
    const draft = normaliseExtractedInvoice({ ...perfectInvoice, total: '50,00' }, options);

    expect(codesOf(draft)).toEqual([DraftProblemCode.PRINTED_TOTAL_MISMATCH]);
    expect(draft.printedTotalMinor).toBe(5000n);
    expect(draft.totals.totalMinor).toBe(4365n);
    expect(draft.problems[0]?.field).toBe('total');
  });

  it('refuses a document discount larger than the subtotal', () => {
    const draft = normaliseExtractedInvoice(
      {
        supplier: { name: 'Furnitori', vatNumber: '811234567' },
        invoiceNumber: '9',
        issueDate: '2026-01-01',
        currency: 'EUR',
        documentDiscount: '99,00',
        lines: [
          { description: 'Shërbim', quantity: '3', unitPrice: '10,00', taxRatePercent: '18' },
        ],
      },
      options,
    );

    expect(codesOf(draft)).toEqual([DraftProblemCode.INVALID_DOCUMENT_DISCOUNT]);
    expect(draft.problems[0]?.severity).toBe('error');
    expect(draft.documentDiscountMinor).toBe(0n);
    expect(draft.totals.totalMinor).toBe(3540n);
    expect(draft.isSaveable).toBe(false);
  });

  it('ignores a document discount it cannot read', () => {
    const draft = normaliseExtractedInvoice(
      {
        supplier: { name: 'Furnitori', vatNumber: '811234567' },
        invoiceNumber: '9',
        issueDate: '2026-01-01',
        currency: 'EUR',
        documentDiscount: 'shumë',
        lines: [
          { description: 'Shërbim', quantity: '3', unitPrice: '10,00', taxRatePercent: '18' },
        ],
      },
      options,
    );

    expect(codesOf(draft)).toEqual([DraftProblemCode.INVALID_DOCUMENT_DISCOUNT]);
    expect(draft.problems[0]?.severity).toBe('warning');
    expect(draft.documentDiscountMinor).toBe(0n);
    expect(draft.isSaveable).toBe(true);
  });

  it('caps the number of lines and reports how many it did not read', () => {
    const line = { description: 'Rresht', quantity: '1', unitPrice: '1,00', taxRatePercent: '18' };
    const draft = normaliseExtractedInvoice(
      {
        supplier: { name: 'Furnitori', vatNumber: '811234567' },
        invoiceNumber: '9',
        issueDate: '2026-01-01',
        currency: 'EUR',
        lines: [line, line, line],
      },
      { defaultCurrency: CurrencyCode.EUR, taxRates: rates, maxLines: 2 },
    );

    expect(draft.lines).toHaveLength(2);
    expect(codesOf(draft)).toEqual([DraftProblemCode.TOO_MANY_LINES]);
    expect(draft.problems[0]?.message).toContain('u kthyen 3');
    expect(draft.totals.subtotalMinor).toBe(200n);
  });

  it('builds the VAT summary a tax authority will read, one row per rate', () => {
    const draft = normaliseExtractedInvoice(perfectInvoice, options);

    expect(draft.totals.taxSummary).toEqual([
      {
        taxRateId: 'vat-18',
        name: 'VAT 18%',
        category: TaxCategory.STANDARD,
        ratePercent: '18',
        baseMinor: 3750n,
        taxMinor: 675n,
      },
      {
        taxRateId: 'vat-8',
        name: 'VAT 8%',
        category: TaxCategory.REDUCED,
        ratePercent: '8',
        baseMinor: 130n,
        taxMinor: 10n,
      },
    ]);
  });
});
