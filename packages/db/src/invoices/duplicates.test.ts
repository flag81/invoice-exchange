/**
 * The duplicate guard: one invoice, stored once.
 *
 * These tests run with a fake Prisma client (`vi.mock('../client')`), because what they pin down is not
 * SQL but the rule around it — that the query is tenant-scoped, that the *oldest* match is the one
 * reported, and that a refusal happens **before** `invoice.create`. The matching itself is
 * `@einv/shared`'s and is tested there; this file only proves the repository actually asks it.
 */

import { CurrencyCode, TaxCategory, normaliseInvoiceSubmission } from '@einv/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('../client', () => ({
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {},
  withDatabase: async (run: (client: unknown) => Promise<unknown>) => run({ invoice: db }),
}));

import { findDuplicateInvoice, saveCapturedInvoice } from './repository';

const rates = [
  { id: 'vat-18', name: 'TVSH 18%', category: TaxCategory.STANDARD, ratePercent: '18' },
] as const;

const tenant = {
  companyId: 'company-1',
  companyName: 'Demo Market Sh.p.k',
  currency: CurrencyCode.EUR,
  countryCode: 'XK',
  taxRates: rates,
  defaultTaxRateId: 'vat-18',
} as const;

/** The same reviewed payload the save route receives: text, not amounts. */
const draft = normaliseInvoiceSubmission(
  {
    currency: 'EUR',
    supplier: { name: 'NPT Kafe Sh.p.k', vatNumber: '811234567', countryCode: 'XK' },
    buyer: { name: 'Demo Market Sh.p.k' },
    invoiceNumber: '2026-0042',
    issueDate: '2026-03-14',
    documentDiscount: '2.00',
    lines: [{ description: 'Kafe 1 kg', quantity: '3', unitPrice: '12.50', taxRateId: 'vat-18' }],
  },
  { defaultCurrency: CurrencyCode.EUR, taxRates: rates },
);

/** A stored row, in the shape `toInvoiceSummaryView` and `toInvoiceView` read. */
function storedInvoice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'invoice-old',
    companyId: 'company-1',
    direction: 'PAYABLE',
    status: 'DRAFT',
    currency: 'EUR',
    invoiceNumber: '2026-0042',
    issueDate: new Date('2026-03-14T00:00:00.000Z'),
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
    documentDiscountMinor: 200n,
    taxMinor: 675n,
    totalMinor: 4225n,
    paidMinor: 0n,
    payableMinor: 4225n,
    taxSummaryJson: '[]',
    captureSource: 'UPLOAD',
    createdAt: new Date('2026-03-15T09:00:00.000Z'),
    updatedAt: new Date('2026-03-15T09:00:00.000Z'),
    lines: [{ id: 'line-1' }],
    ...overrides,
  };
}

const duplicateInput = {
  companyId: 'company-1',
  invoiceNumber: '2026-0042',
  supplierVatNumber: '811234567',
  supplierName: 'NPT Kafe Sh.p.k',
};

beforeEach(() => {
  db.findMany.mockReset();
  db.create.mockReset();
  db.updateMany.mockReset();
});

describe('findDuplicateInvoice', () => {
  it('does not query the database when there is no number to compare', async () => {
    await expect(
      findDuplicateInvoice({ ...duplicateInput, invoiceNumber: null }),
    ).resolves.toBeNull();

    expect(db.findMany).not.toHaveBeenCalled();
  });

  it('returns the oldest match for the tenant, as the invoice to send the person back to', async () => {
    db.findMany.mockResolvedValue([
      storedInvoice({ id: 'invoice-original' }),
      storedInvoice({ id: 'invoice-copy', createdAt: new Date('2026-04-01T09:00:00.000Z') }),
    ]);

    const duplicate = await findDuplicateInvoice(duplicateInput);

    expect(duplicate).toMatchObject({
      id: 'invoice-original',
      invoiceNumber: '2026-0042',
      supplierName: 'NPT Kafe Sh.p.k',
      issueDate: '2026-03-14',
      totalMinor: '4225',
    });

    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company-1', invoiceNumber: { not: null } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('returns null when the number exists only for another supplier', async () => {
    db.findMany.mockResolvedValue([storedInvoice({ supplierVatNumber: '810998877' })]);

    await expect(findDuplicateInvoice(duplicateInput)).resolves.toBeNull();
  });
});

describe('saveCapturedInvoice', () => {
  it('refuses the second copy with the details the review screen needs', async () => {
    db.findMany.mockResolvedValue([storedInvoice()]);

    await expect(
      saveCapturedInvoice({ tenant, draft, captureSource: 'UPLOAD' }),
    ).rejects.toMatchObject({
      code: 'DUPLICATE_INVOICE',
      details: {
        id: 'invoice-old',
        invoiceNumber: '2026-0042',
        supplierName: 'NPT Kafe Sh.p.k',
        issueDate: '2026-03-14',
        totalMinor: '4225',
      },
    });

    // The point of the guard: nothing is written.
    expect(db.create).not.toHaveBeenCalled();
  });

  it('stores an invoice the tenant does not have yet', async () => {
    db.findMany.mockResolvedValue([
      storedInvoice({ invoiceNumber: '2026-0001' }),
      storedInvoice({ id: 'invoice-other', supplierVatNumber: '810998877' }),
    ]);
    db.create.mockResolvedValue(storedInvoice({ id: 'invoice-new', lines: [] }));

    const saved = await saveCapturedInvoice({ tenant, draft, captureSource: 'UPLOAD' });

    expect(saved.id).toBe('invoice-new');
    expect(db.create).toHaveBeenCalledTimes(1);
    expect(db.create.mock.calls[0]?.[0]).toMatchObject({
      data: { companyId: 'company-1', invoiceNumber: '2026-0042', captureSource: 'UPLOAD' },
    });
  });
});
