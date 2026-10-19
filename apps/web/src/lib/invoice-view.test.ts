import { CurrencyCode, TaxCategory, type TaxRate } from '@einv/shared';
import { describe, expect, it } from 'vitest';

import {
  previewTotals,
  toDuplicateInvoice,
  toReviewForm,
  toSubmitPayload,
  type DraftView,
  type ReviewForm,
} from './invoice-view';

const rates: readonly TaxRate[] = [
  { id: 'rate-18', name: 'TVSH 18%', category: TaxCategory.STANDARD, ratePercent: '18' },
  { id: 'rate-8', name: 'TVSH 8%', category: TaxCategory.REDUCED, ratePercent: '8' },
];

const draft: DraftView = {
  currency: 'EUR',
  defaultCurrency: 'EUR',
  supplier: {
    name: 'NPT Kafe Sh.p.k',
    vatNumber: '811234567',
    address: 'Rr. Luan Haradinaj 12',
    countryCode: 'XK',
  },
  buyer: { name: 'Demo Market Sh.p.k', vatNumber: null },
  invoiceNumber: '2026-0042',
  issueDate: '2026-03-14',
  dueDate: null,
  notes: null,
  documentDiscount: '2.00',
  lines: [
    {
      position: 1,
      description: 'Kafe 1 kg',
      quantity: '3',
      unitPrice: '12.50',
      lineDiscount: '0.00',
      taxRateId: 'rate-18',
      taxRatePercent: '18',
      lineTotal: '37.50',
      taxAmount: '6.75',
      printedLineTotal: '37.50',
    },
  ],
  totals: {
    subtotal: '37.50',
    lineDiscount: '0.00',
    documentDiscount: '2.00',
    tax: '6.75',
    total: '42.25',
    taxSummary: [],
  },
  problems: [],
  isSaveable: true,
};

describe('toReviewForm', () => {
  it('turns every absent value into an empty field, so the form never shows "null"', () => {
    const form = toReviewForm(draft);

    expect(form.supplierName).toBe('NPT Kafe Sh.p.k');
    expect(form.dueDate).toBe('');
    expect(form.notes).toBe('');
    expect(form.buyerVatNumber).toBe('');
    expect(form.lines).toHaveLength(1);
    expect(form.lines[0]).toEqual({
      taxRateId: 'rate-18',
      description: 'Kafe 1 kg',
      quantity: '3',
      unitPrice: '12.50',
      lineDiscount: '0.00',
    });
  });

  it('round-trips through the payload the save endpoint expects', () => {
    const payload = toSubmitPayload(toReviewForm(draft), {
      extractionId: 'extraction-1',
      captureSource: 'CAMERA',
    });

    expect(payload).toMatchObject({
      currency: 'EUR',
      invoiceNumber: '2026-0042',
      issueDate: '2026-03-14',
      documentDiscount: '2.00',
      captureSource: 'CAMERA',
      extractionId: 'extraction-1',
      supplier: { name: 'NPT Kafe Sh.p.k', vatNumber: '811234567', countryCode: 'XK' },
    });
    expect(payload['lines']).toEqual([
      {
        description: 'Kafe 1 kg',
        quantity: '3',
        unitPrice: '12.50',
        lineDiscount: '0.00',
        taxRateId: 'rate-18',
      },
    ]);
  });
});

describe('toDuplicateInvoice', () => {
  const existing = {
    id: 'invoice-old',
    status: 'DRAFT',
    currency: 'EUR',
    invoiceNumber: '2026-0042',
    supplierName: 'NPT Kafe Sh.p.k',
    issueDate: '2026-03-14',
    totalMinor: '4225',
    payableMinor: '4225',
    lineCount: 1,
    createdAt: '2026-03-15T09:00:00.000Z',
  };

  it('reads the summary the duplicate-check route returns, ignoring fields it does not need', () => {
    expect(toDuplicateInvoice(existing)).toEqual({
      id: 'invoice-old',
      invoiceNumber: '2026-0042',
      supplierName: 'NPT Kafe Sh.p.k',
      issueDate: '2026-03-14',
      totalMinor: '4225',
      currency: 'EUR',
    });
  });

  it('reads the same invoice out of the 409 details, which carry nothing else', () => {
    const details = {
      id: 'invoice-old',
      invoiceNumber: '2026-0042',
      supplierName: 'NPT Kafe Sh.p.k',
      issueDate: '2026-03-14',
      totalMinor: '4225',
      currency: 'EUR',
    };

    expect(toDuplicateInvoice(details)?.id).toBe('invoice-old');
  });

  it('treats absent optional fields as absent rather than as text', () => {
    const parsed = toDuplicateInvoice({ ...existing, invoiceNumber: '', issueDate: null });

    expect(parsed?.invoiceNumber).toBeNull();
    expect(parsed?.issueDate).toBeNull();
  });

  it('refuses a payload that is not an invoice instead of half-rendering it', () => {
    expect(toDuplicateInvoice(null)).toBeNull();
    expect(toDuplicateInvoice('invoice-old')).toBeNull();
    expect(toDuplicateInvoice({ id: 'invoice-old' })).toBeNull();
    expect(toDuplicateInvoice({ ...existing, totalMinor: '42,25' })).toBeNull();
    expect(toDuplicateInvoice({ ...existing, supplierName: '   ' })).toBeNull();
  });
});

describe('previewTotals', () => {
  it('runs the domain arithmetic on the text in the fields', () => {
    // 3 × 12,50 = 37,50 → 6,75 VAT; less 2,00 → 42,25
    const preview = previewTotals(toReviewForm(draft), rates);

    expect(preview).toEqual({ subtotal: '37.50', tax: '6.75', total: '42.25', error: null });
  });

  it('understands the comma a phone keypad produces', () => {
    const form: ReviewForm = {
      ...toReviewForm(draft),
      documentDiscount: '0',
      lines: [
        {
          taxRateId: 'rate-8',
          description: 'Ujë',
          quantity: '2,5',
          unitPrice: '4,00',
          lineDiscount: '1,00',
        },
      ],
    };

    const preview = previewTotals(form, rates);

    expect(preview.subtotal).toBe('9.00');
    expect(preview.tax).toBe('0.72');
    expect(preview.total).toBe('9.72');
    expect(preview.error).toBeNull();
  });

  it('shows dashes instead of a number while a field is half-typed', () => {
    const form: ReviewForm = {
      ...toReviewForm(draft),
      lines: [{ ...toReviewForm(draft).lines[0]!, quantity: '-1' }],
    };

    const preview = previewTotals(form, rates);

    expect(preview.total).toBe('—');
    expect(preview.error).toContain('nuk pranohet');
  });

  it('refuses a discount larger than the subtotal, exactly as the server will', () => {
    const form: ReviewForm = { ...toReviewForm(draft), documentDiscount: '999.00' };

    const preview = previewTotals(form, rates);

    expect(preview.total).toBe('—');
    expect(preview.error).toContain('nuk pranohet');
  });

  it('refuses to guess when the selected rate is not in the table', () => {
    const form: ReviewForm = {
      ...toReviewForm(draft),
      lines: [{ ...toReviewForm(draft).lines[0]!, taxRateId: 'rate-missing' }],
    };

    const preview = previewTotals(form, rates);

    expect(preview.total).toBe('—');
    expect(preview.error).toContain('rate-missing');
  });

  it('treats an empty field as zero, which is what a blank discount means', () => {
    const form: ReviewForm = {
      ...toReviewForm(draft),
      documentDiscount: '',
      lines: [{ ...toReviewForm(draft).lines[0]!, lineDiscount: '' }],
    };

    const preview = previewTotals(form, rates);

    expect(preview.subtotal).toBe('37.50');
    expect(preview.total).toBe('44.25');
  });

  it('falls back to EUR when the currency is not one it knows', () => {
    const form: ReviewForm = {
      ...toReviewForm(draft),
      currency: 'XBT',
      documentDiscount: '0',
      lines: [
        {
          taxRateId: 'rate-18',
          description: 'X',
          quantity: '1',
          unitPrice: '10.00',
          lineDiscount: '',
        },
      ],
    };

    expect(previewTotals(form, rates).total).toBe('11.80');
  });

  it('uses the currency exponent, not a hard-coded 2 places', () => {
    const form: ReviewForm = {
      ...toReviewForm(draft),
      currency: CurrencyCode.JPY,
      documentDiscount: '0',
      lines: [
        {
          taxRateId: 'rate-18',
          description: 'Yen item',
          quantity: '1',
          unitPrice: '1000',
          lineDiscount: '',
        },
      ],
    };

    const preview = previewTotals(form, rates);

    expect(preview.subtotal).toBe('1000');
    expect(preview.tax).toBe('180');
    expect(preview.total).toBe('1180');
  });
});
