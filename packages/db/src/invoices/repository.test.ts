import { CurrencyCode, TaxCategory, normaliseInvoiceSubmission } from '@einv/shared';
import { describe, expect, it } from 'vitest';

import {
  CaptureSource,
  formatCalendarDate,
  parseCalendarDate,
  parseTaxSummary,
  serialiseTaxSummary,
  toInvoiceCreateData,
} from './mappers';
import { quantityText, rowTotalsAreConsistent, toInvoiceTotals, toInvoiceView } from './view';
import type { InvoiceRow } from './view';

const rates = [
  { id: 'rate-18', name: 'TVSH 18%', category: TaxCategory.STANDARD, ratePercent: '18' },
  { id: 'rate-8', name: 'TVSH 8%', category: TaxCategory.REDUCED, ratePercent: '8' },
] as const;

/** A reviewed payload, normalised by the domain — the same input the save route receives. */
const reviewed = {
  currency: 'EUR',
  supplier: { name: 'NPT Kafe Sh.p.k', vatNumber: '811234567', countryCode: 'XK' },
  buyer: { name: 'Demo Market Sh.p.k' },
  invoiceNumber: '2026-0042',
  issueDate: '2026-03-14',
  dueDate: '2026-04-14',
  notes: 'Dorëzuar',
  documentDiscount: '2,00',
  lines: [
    { description: 'Kafe 1 kg', quantity: '3', unitPrice: '12,50', taxRateId: 'rate-18' },
    { description: 'Uji 1.5 l', quantity: '2,5', unitPrice: '4,00', taxRateId: 'rate-8' },
  ],
};

const draft = normaliseInvoiceSubmission(reviewed, {
  defaultCurrency: CurrencyCode.EUR,
  taxRates: rates,
});

describe('calendar dates', () => {
  it('builds a date in UTC, so no timezone moves the day printed on the paper', () => {
    const date = parseCalendarDate('2026-03-14');

    expect(date.toISOString()).toBe('2026-03-14T00:00:00.000Z');
    expect(formatCalendarDate(date)).toBe('2026-03-14');
  });

  it('round-trips every kind of day, including a leap day', () => {
    for (const iso of ['2024-02-29', '2026-01-01', '2026-12-31', '1999-12-31']) {
      expect(formatCalendarDate(parseCalendarDate(iso))).toBe(iso);
    }
  });

  it('refuses anything that is not a `YYYY-MM-DD` date', () => {
    expect(() => parseCalendarDate('14.03.2026')).toThrowError(/nuk është një datë kalendarike/);
    expect(() => parseCalendarDate('2026-3-4')).toThrowError(/nuk është një datë kalendarike/);
  });

  it('formats a missing date as null rather than an empty string', () => {
    expect(formatCalendarDate(null)).toBeNull();
  });
});

describe('tax summary JSON', () => {
  it('writes bigints as decimal strings, because JSON cannot carry a bigint', () => {
    const json = serialiseTaxSummary([
      {
        taxRateId: 'rate-18',
        name: 'TVSH 18%',
        category: TaxCategory.STANDARD,
        ratePercent: '18',
        baseMinor: 3750n,
        taxMinor: 675n,
      },
    ]);

    expect(json).toContain('"baseMinor":"3750"');

    expect(parseTaxSummary(json)).toEqual([
      {
        taxRateId: 'rate-18',
        name: 'TVSH 18%',
        category: TaxCategory.STANDARD,
        ratePercent: '18',
        baseMinor: 3750n,
        taxMinor: 675n,
      },
    ]);
  });

  it('returns an empty summary for a corrupt snapshot instead of throwing', () => {
    expect(parseTaxSummary('{not json')).toEqual([]);
    expect(parseTaxSummary('"a string"')).toEqual([]);
    expect(parseTaxSummary('[42]')).toEqual([]);
    expect(parseTaxSummary('[{"taxRateId":"x","baseMinor":"not a number"}]')).toEqual([]);
  });
});

describe('toInvoiceCreateData', () => {
  it('turns a reviewed draft into the exact row the database gets', () => {
    const data = toInvoiceCreateData(draft, {
      companyId: 'company-1',
      captureSource: CaptureSource.CAMERA,
    });

    expect(data).toMatchObject({
      companyId: 'company-1',
      direction: 'PAYABLE',
      status: 'DRAFT',
      currency: CurrencyCode.EUR,
      invoiceNumber: '2026-0042',
      supplierName: 'NPT Kafe Sh.p.k',
      supplierVatNumber: '811234567',
      supplierCountryCode: 'XK',
      buyerName: 'Demo Market Sh.p.k',
      notes: 'Dorëzuar',
      captureSource: 'CAMERA',
      // 3750 + 1000 = 4750 subtotal · 675 + 80 = 755 tax · 4750 + 755 − 200 = 5305 total
      subtotalMinor: 4750n,
      documentDiscountMinor: 200n,
      taxMinor: 755n,
      totalMinor: 5305n,
      payableMinor: 5305n,
      paidMinor: 0n,
    });
    expect(data.issueDate?.toISOString()).toBe('2026-03-14T00:00:00.000Z');
    expect(data.dueDate?.toISOString()).toBe('2026-04-14T00:00:00.000Z');

    expect(data.lines.create).toHaveLength(2);
    expect(data.lines.create[0]).toEqual({
      position: 1,
      description: 'Kafe 1 kg',
      quantityScaled: 30_000n,
      unitPriceMinor: 1250n,
      lineDiscountMinor: 0n,
      lineTotalMinor: 3750n,
      taxMinor: 675n,
      taxRateId: 'rate-18',
      taxRatePercentSnapshot: '18',
      taxCategorySnapshot: TaxCategory.STANDARD,
    });
    expect(data.lines.create[1]).toMatchObject({
      quantityScaled: 25_000n,
      lineTotalMinor: 1000n,
      taxMinor: 80n,
      taxRatePercentSnapshot: '8',
    });
    expect(parseTaxSummary(data.taxSummaryJson)).toHaveLength(2);
  });

  it('refuses a draft with no supplier name, because it is not a document', () => {
    const nameless = { ...draft, supplier: { ...draft.supplier, name: null } };

    expect(() =>
      toInvoiceCreateData(nameless, { companyId: 'c', captureSource: CaptureSource.MANUAL }),
    ).toThrowError(/pa emrin e furnitorit/);
  });

  it('refuses a draft with no lines, because a total needs something to add up', () => {
    expect(() =>
      toInvoiceCreateData(
        { ...draft, lines: [] },
        { companyId: 'c', captureSource: CaptureSource.MANUAL },
      ),
    ).toThrowError(/pa rreshta/);
  });
});

const consistentRow: InvoiceRow = {
  id: 'invoice-1',
  companyId: 'company-1',
  direction: 'PAYABLE',
  status: 'DRAFT',
  currency: 'EUR',
  invoiceNumber: '2026-0042',
  issueDate: parseCalendarDate('2026-03-14'),
  dueDate: null,
  supplierName: 'NPT Kafe Sh.p.k',
  supplierVatNumber: '811234567',
  supplierAddress: null,
  supplierCountryCode: 'XK',
  buyerName: 'Demo Market Sh.p.k',
  buyerVatNumber: null,
  notes: null,
  subtotalMinor: 3750n,
  lineDiscountMinor: 0n,
  documentDiscountMinor: 0n,
  taxMinor: 675n,
  totalMinor: 4425n,
  paidMinor: 0n,
  payableMinor: 4425n,
  taxSummaryJson: serialiseTaxSummary([
    {
      taxRateId: 'rate-18',
      name: 'TVSH 18%',
      category: TaxCategory.STANDARD,
      ratePercent: '18',
      baseMinor: 3750n,
      taxMinor: 675n,
    },
  ]),
  captureSource: 'CAMERA',
  createdAt: new Date('2026-03-15T09:00:00.000Z'),
  updatedAt: new Date('2026-03-15T09:00:00.000Z'),
  lines: [
    {
      id: 'line-1',
      position: 1,
      description: 'Kafe 1 kg',
      quantityScaled: 30_000n,
      unitPriceMinor: 1250n,
      lineDiscountMinor: 0n,
      lineTotalMinor: 3750n,
      taxMinor: 675n,
      taxRateId: 'rate-18',
      taxRatePercentSnapshot: '18',
      taxCategorySnapshot: 'STANDARD',
    },
  ],
};

describe('reading a row back', () => {
  it('rebuilds the domain totals, including the VAT summary', () => {
    const totals = toInvoiceTotals(consistentRow);

    expect(totals.currency).toBe(CurrencyCode.EUR);
    expect(totals.subtotalMinor).toBe(3750n);
    expect(totals.totalMinor).toBe(4425n);
    expect(totals.taxSummary).toHaveLength(1);
    expect(rowTotalsAreConsistent(consistentRow)).toBe(true);
  });

  it('reports a stored row whose totals no longer match its lines', () => {
    const tampered: InvoiceRow = { ...consistentRow, totalMinor: 1n };

    expect(rowTotalsAreConsistent(tampered)).toBe(false);
    expect(toInvoiceView(tampered).totalsConsistent).toBe(false);
  });

  it('serialises money as strings and dates as ISO, because JSON has no bigint', () => {
    const view = toInvoiceView(consistentRow);

    expect(view.totals.totalMinor).toBe('4425');
    expect(view.totals.taxSummary[0]).toEqual({
      taxRateId: 'rate-18',
      name: 'TVSH 18%',
      category: 'STANDARD',
      ratePercent: '18',
      baseMinor: '3750',
      taxMinor: '675',
    });
    // The whole view must survive the trip through `Response.json` (a bigint anywhere throws).
    expect(() => JSON.stringify(view)).not.toThrow();
    expect(view.lines[0]).toMatchObject({
      quantity: '3',
      unitPriceMinor: '1250',
      lineTotalMinor: '3750',
      taxRatePercent: '18',
    });
    expect(view.issueDate).toBe('2026-03-14');
    expect(view.dueDate).toBeNull();
    expect(view.createdAt).toBe('2026-03-15T09:00:00.000Z');
    expect(view.supplier).toEqual({
      name: 'NPT Kafe Sh.p.k',
      vatNumber: '811234567',
      address: null,
      countryCode: 'XK',
    });
    expect(view.totalsConsistent).toBe(true);
  });

  it('renders quantities in the machine format the mobile client parses', () => {
    expect(quantityText(25_000n)).toBe('2.5');
    expect(quantityText(30_000n)).toBe('3');
    expect(quantityText(1n)).toBe('0.0001');
    expect(quantityText(1_234_567n)).toBe('123.4567');
  });

  it('handles a row with no lines without pretending it has some', () => {
    expect(toInvoiceView({ ...consistentRow, lines: undefined }).lines).toEqual([]);
  });
});
