import { describe, expect, it } from 'vitest';

import {
  findDuplicate,
  invoiceIdentity,
  isSameInvoice,
  normaliseInvoiceNumber,
  normaliseSupplierName,
  normaliseVatNumber,
  supplierIdentity,
  type InvoiceIdentity,
} from './duplicates';

const invoice: InvoiceIdentity = {
  invoiceNumber: '2026-0042',
  supplierVatNumber: '811234567',
  supplierName: 'NPT Kafe Sh.p.k',
};

describe('invoice numbers', () => {
  it('ignores case and the whitespace a reader adds around and inside a number', () => {
    expect(normaliseInvoiceNumber(' 2026-0042 ')).toBe('2026-0042');
    expect(normaliseInvoiceNumber('2026   0042')).toBe('2026 0042');
    expect(normaliseInvoiceNumber('inv 7')).toBe('INV 7');
  });

  it('does not reinterpret punctuation: 2026/0042 and 2026-0042 stay two numbers', () => {
    expect(normaliseInvoiceNumber('2026/0042')).not.toBe(normaliseInvoiceNumber('2026-0042'));
  });

  it('treats a blank number as absent rather than as a value every invoice shares', () => {
    expect(normaliseInvoiceNumber('')).toBeNull();
    expect(normaliseInvoiceNumber('   ')).toBeNull();
    expect(normaliseInvoiceNumber(null)).toBeNull();
  });
});

describe('supplier identity', () => {
  it('reads a VAT number as digits, however it was printed', () => {
    expect(normaliseVatNumber('811 234 567')).toBe('811234567');
    expect(normaliseVatNumber('XK 811.234.567')).toBe('811234567');
    expect(normaliseVatNumber('811234567')).toBe('811234567');
  });

  it('refuses a VAT value too short to identify anyone', () => {
    expect(normaliseVatNumber('0')).toBeNull();
    expect(normaliseVatNumber('N/A')).toBeNull();
    expect(normaliseVatNumber('')).toBeNull();
    expect(normaliseVatNumber(null)).toBeNull();
  });

  it('normalises a name by removing punctuation, spacing and case', () => {
    expect(normaliseSupplierName('NPT Kafe Sh.p.k.')).toBe('NPTKAFESHPK');
    expect(normaliseSupplierName(' npt kafe  SHPK ')).toBe('NPTKAFESHPK');
  });

  it('keeps letters outside ASCII, so two different names cannot collapse into one', () => {
    expect(normaliseSupplierName('Çeliku')).toBe('ÇELIKU');
    expect(normaliseSupplierName('Çeliku')).not.toBe(normaliseSupplierName('eliku'));
  });

  it('prefers the VAT number to the name, because the name is spelled several ways', () => {
    expect(
      supplierIdentity({ supplierVatNumber: '811234567', supplierName: 'NPT Kafe Sh.p.k' }),
    ).toBe('811234567');

    expect(supplierIdentity({ supplierVatNumber: 'N/A', supplierName: 'NPT Kafe Sh.p.k' })).toBe(
      'NPTKAFESHPK',
    );
  });
});

describe('the same invoice twice', () => {
  it('builds one key from the supplier and the number', () => {
    expect(invoiceIdentity(invoice)).toBe('811234567#2026-0042');
  });

  it('matches a re-read of the same paper, however the two reads were formatted', () => {
    const reread: InvoiceIdentity = {
      invoiceNumber: ' 2026-0042',
      supplierVatNumber: 'XK 811.234.567',
      supplierName: 'NPT Kafe SH.P.K.',
    };

    expect(isSameInvoice(reread, invoice)).toBe(true);
    expect(findDuplicate(reread, [{ ...invoice, id: 'invoice-1' }])).toMatchObject({
      id: 'invoice-1',
    });
  });

  it('does not match a different number from the same supplier', () => {
    expect(isSameInvoice({ ...invoice, invoiceNumber: '2026-0043' }, invoice)).toBe(false);
  });

  it('does not match the same number from a different supplier', () => {
    expect(isSameInvoice({ ...invoice, supplierVatNumber: '810998877' }, invoice)).toBe(false);
  });

  it('does not match two suppliers that share a name but not a VAT number', () => {
    const named: InvoiceIdentity = { ...invoice, supplierVatNumber: null };
    const otherVat: InvoiceIdentity = { ...invoice, supplierVatNumber: '812345678' };

    expect(isSameInvoice(named, otherVat)).toBe(false);
  });

  it('falls back to the name only when a VAT number is absent on both sides', () => {
    const first: InvoiceIdentity = { ...invoice, supplierVatNumber: null };
    const second: InvoiceIdentity = {
      ...invoice,
      supplierVatNumber: 'N/A',
      supplierName: 'NPT Kafe Sh.p.k.',
    };

    expect(isSameInvoice(second, first)).toBe(true);
  });

  it('never calls an invoice without a number a duplicate', () => {
    const unnumbered: InvoiceIdentity = { ...invoice, invoiceNumber: null };

    expect(invoiceIdentity(unnumbered)).toBeNull();
    expect(isSameInvoice(unnumbered, { ...invoice, invoiceNumber: null })).toBe(false);
    expect(findDuplicate(unnumbered, [invoice])).toBeNull();
  });

  it('never calls an invoice without a supplier identity a duplicate', () => {
    const unnamed: InvoiceIdentity = {
      ...invoice,
      supplierVatNumber: null,
      supplierName: '   ',
    };

    expect(invoiceIdentity(unnamed)).toBeNull();
    expect(findDuplicate(unnamed, [invoice])).toBeNull();
  });

  it('returns the first match in the order the caller supplied, and null on no match', () => {
    const original = { ...invoice, id: 'original' };
    const copy = { ...invoice, id: 'copy' };
    const other = { ...invoice, id: 'other', invoiceNumber: '2026-0099' };

    expect(findDuplicate(invoice, [other, original, copy])).toMatchObject({ id: 'original' });
    expect(findDuplicate({ ...invoice, invoiceNumber: '2027-0001' }, [original, copy])).toBeNull();
  });
});
