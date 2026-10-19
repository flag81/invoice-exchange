import { describe, expect, it } from 'vitest';

import {
  CurrencyCode,
  DomainErrorCode,
  INVOICE_STATUSES,
  InvoiceStatus,
  TaxCategory,
  assertInvoiceShape,
  computeTotals,
  type InvoiceShape,
  type TaxRate,
} from '../index';
import { expectDomainError } from '../testing/domain-error';

const vat18: TaxRate = {
  id: 'vat-18',
  name: 'VAT 18%',
  category: TaxCategory.STANDARD,
  ratePercent: '18',
};

const draft: InvoiceShape = {
  supplierCompanyId: 'company-supplier',
  buyerCompanyId: 'company-buyer',
  status: InvoiceStatus.DRAFT,
};

function issued(overrides: Partial<InvoiceShape> = {}): InvoiceShape {
  return {
    supplierCompanyId: 'company-supplier',
    buyerCompanyId: 'company-buyer',
    status: InvoiceStatus.ISSUED,
    number: 'INV-2026-0001',
    lockedAt: new Date('2026-03-01T09:00:00.000Z'),
    versions: [{ version: 1 }],
    ...overrides,
  };
}

describe('assertInvoiceShape: between two companies (invariant 1)', () => {
  it('accepts an invoice between two different companies', () => {
    expect(() => assertInvoiceShape(draft)).not.toThrow();
    expect(() => assertInvoiceShape(issued())).not.toThrow();
  });

  it('refuses an invoice a company sends to itself', () => {
    const error = expectDomainError(
      () => assertInvoiceShape({ ...draft, buyerCompanyId: 'company-supplier' }),
      DomainErrorCode.INVALID_INVOICE,
    );

    expect(error.details).toEqual({ companyId: 'company-supplier' });
  });
});

describe('assertInvoiceShape: the draft/locked split (invariant 3)', () => {
  it('lets a draft carry no number and no lockedAt yet', () => {
    expect(() => assertInvoiceShape({ ...draft, number: null, lockedAt: null })).not.toThrow();
    expect(() =>
      assertInvoiceShape({ ...draft, number: undefined, lockedAt: undefined, versions: [] }),
    ).not.toThrow();
  });

  it('asks a locked invoice for a number', () => {
    for (const number of [undefined, null, '', '   ']) {
      const error = expectDomainError(
        () => assertInvoiceShape(issued({ number })),
        DomainErrorCode.INVALID_INVOICE,
      );

      expect(error.message).toContain('must already carry a number');
      expect(error.details).toEqual({ status: InvoiceStatus.ISSUED });
    }
  });

  it('asks a locked invoice for a lockedAt, as a date or as the string the database returns', () => {
    for (const lockedAt of [undefined, null, '']) {
      expectDomainError(
        () => assertInvoiceShape(issued({ lockedAt })),
        DomainErrorCode.INVALID_INVOICE,
      );
    }

    expect(() =>
      assertInvoiceShape(issued({ lockedAt: '2026-03-01T09:00:00.000Z' })),
    ).not.toThrow();
  });

  it('asks a locked invoice for a version 1 snapshot, and stops asking once it is there', () => {
    expectDomainError(
      () => assertInvoiceShape(issued({ versions: [] })),
      DomainErrorCode.INVALID_INVOICE,
    );
    expectDomainError(
      () => assertInvoiceShape(issued({ versions: [{ version: 2 }] })),
      DomainErrorCode.INVALID_INVOICE,
    );

    expect(() =>
      assertInvoiceShape(issued({ versions: [{ version: 2 }, { version: 1 }] })),
    ).not.toThrow();
  });

  it('applies the same three rules to every status that is not DRAFT', () => {
    for (const status of INVOICE_STATUSES) {
      const shape: InvoiceShape = {
        supplierCompanyId: 'company-supplier',
        buyerCompanyId: 'company-buyer',
        status,
      };

      if (status === InvoiceStatus.DRAFT) {
        expect(() => assertInvoiceShape(shape)).not.toThrow();
      } else {
        expectDomainError(() => assertInvoiceShape(shape), DomainErrorCode.INVALID_INVOICE);
      }
    }
  });
});

describe('assertInvoiceShape: the totals it is shown (invariant 2)', () => {
  const totals = computeTotals({
    currency: CurrencyCode.EUR,
    lines: [{ quantity: '2', unitPriceMinor: 2500n, taxRate: vat18 }],
  });

  it('accepts totals that add up, on a draft as well as on an issued invoice', () => {
    expect(() => assertInvoiceShape({ ...draft, totals })).not.toThrow();
    expect(() => assertInvoiceShape({ ...issued(), totals })).not.toThrow();
  });

  it('refuses totals that do not add up — even on a draft, which leaves no other rule to check', () => {
    expectDomainError(
      () => assertInvoiceShape({ ...draft, totals: { ...totals, totalMinor: 0n } }),
      DomainErrorCode.TOTALS_MISMATCH,
    );
  });
});
