/**
 * The list's search: what the box's text becomes, and the `where` it turns into.
 *
 * `withDatabase` is replaced by a recorder, so these assertions are about the query itself — the
 * tenant scope and the two places a word may be found — and need no database to run.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INVOICE_SEARCH_MAX_LENGTH,
  invoiceSearchTerms,
  listInvoices,
  normaliseInvoiceSearch,
} from './repository';

const mocks = vi.hoisted(() => ({
  withDatabase: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('../client', () => ({ withDatabase: mocks.withDatabase }));

describe('normaliseInvoiceSearch', () => {
  it('trims and collapses the whitespace a pasted line arrives with', () => {
    expect(normaliseInvoiceSearch('  NPT \t Kafe  ')).toBe('NPT Kafe');
  });

  it('keeps the case it was given, because Postgres does the folding', () => {
    expect(normaliseInvoiceSearch('Kafe')).toBe('Kafe');
  });

  it('treats a missing, blank or non-string value as no search at all', () => {
    expect(normaliseInvoiceSearch(undefined)).toBe('');
    expect(normaliseInvoiceSearch(null)).toBe('');
    expect(normaliseInvoiceSearch('   ')).toBe('');
  });

  it('cuts a pasted paragraph at the length the query will use', () => {
    const long = 'a'.repeat(INVOICE_SEARCH_MAX_LENGTH + 50);

    expect(normaliseInvoiceSearch(long)).toHaveLength(INVOICE_SEARCH_MAX_LENGTH);
  });
});

describe('invoiceSearchTerms', () => {
  it('splits on words, so `NPT Kafe` finds a supplier stored as `NPT Kafe Sh.p.k`', () => {
    expect(invoiceSearchTerms('NPT  Kafe')).toEqual(['NPT', 'Kafe']);
  });

  it('drops a repeat, so `kafe KAFE kafe` asks one question', () => {
    expect(invoiceSearchTerms('kafe KAFE kafe')).toEqual(['kafe']);
  });

  it('has no words when the box is empty', () => {
    expect(invoiceSearchTerms('')).toEqual([]);
    expect(invoiceSearchTerms(undefined)).toEqual([]);
  });

  it('stops at eight words, so a pasted document is not a query', () => {
    expect(invoiceSearchTerms('a b c d e f g h i j')).toHaveLength(8);
  });
});

describe('listInvoices search', () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.findMany.mockResolvedValue([]);
    mocks.withDatabase.mockReset();
    mocks.withDatabase.mockImplementation(async (run: (client: unknown) => Promise<unknown>) =>
      run({ invoice: { findMany: mocks.findMany } }),
    );
  });

  it('matches every word against the supplier name or a line description, inside the tenant', async () => {
    await listInvoices('company-1', { search: 'Kafe 1kg' });

    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    const [args] = mocks.findMany.mock.calls[0] as [Record<string, unknown>];

    expect(args.where).toEqual({
      companyId: 'company-1',
      AND: [
        {
          OR: [
            { supplierName: { contains: 'Kafe', mode: 'insensitive' } },
            { lines: { some: { description: { contains: 'Kafe', mode: 'insensitive' } } } },
          ],
        },
        {
          OR: [
            { supplierName: { contains: '1kg', mode: 'insensitive' } },
            { lines: { some: { description: { contains: '1kg', mode: 'insensitive' } } } },
          ],
        },
      ],
    });
    // Still the newest-first order and the tenant's own rows; a search narrows, it does not reorder.
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('asks for the tenant’s rows and nothing else when the box is empty', async () => {
    await listInvoices('company-1');

    const [args] = mocks.findMany.mock.calls[0] as [Record<string, unknown>];

    expect(args.where).toEqual({ companyId: 'company-1' });
  });
});
