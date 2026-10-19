/**
 * The structural invariants of an invoice from §4.3, as one guard.
 *
 * Invariants 1–3 of the architecture document say:
 *
 * 1. an invoice is between two *different* companies;
 * 2. `sum(lineTotal) = subtotal` and `subtotal + tax − discount = total`;
 * 3. once it leaves `DRAFT`, it has a number, a `lockedAt` and a version 1.
 *
 * They are enforced in both layers on purpose — a TypeScript guard here and a database constraint in
 * phase 2 — because "a violation is a bug, not a validation message". This function is the TypeScript
 * half, and it is deliberately tolerant about what is *present*: it checks the facts it is given, so the
 * same guard works on a draft in memory, on a row read back from the database and on a payload decoded
 * from a version snapshot.
 *
 * Invariants 4 and 5 (every transition is in the table; versions are append-only) are not runtime checks:
 * the first is the table in `transitions.ts` plus its exhaustive test, and the second is a property of
 * the database grants.
 */

import { DomainErrorCode, fail } from '../errors';
import { assertTotalsConsistent, type InvoiceTotals } from '../totals';
import { isInvoiceLocked, type InvoiceStatus } from './status';

export type InvoiceShape = {
  readonly supplierCompanyId: string;
  readonly buyerCompanyId: string;
  readonly status: InvoiceStatus;
  /** `null`/absent while the invoice is a draft. */
  readonly number?: string | null;
  readonly lockedAt?: Date | string | null;
  /** Version rows, when the caller has them; only "does version 1 exist" is checked. */
  readonly versions?: readonly { readonly version: number }[];
  /** Totals, when they have been derived; validated against the arithmetic identities. */
  readonly totals?: InvoiceTotals;
};

function isMissing(value: string | Date | null | undefined): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  return typeof value === 'string' && value.trim() === '';
}

/** Throws a `DomainError` naming the broken invariant; returns nothing when the shape is sound. */
export function assertInvoiceShape(invoice: InvoiceShape): void {
  if (invoice.supplierCompanyId === invoice.buyerCompanyId) {
    fail(DomainErrorCode.INVALID_INVOICE, 'an invoice must be between two different companies', {
      companyId: invoice.supplierCompanyId,
    });
  }

  if (invoice.totals !== undefined) {
    assertTotalsConsistent(invoice.totals);
  }

  if (!isInvoiceLocked(invoice.status)) {
    return;
  }

  if (isMissing(invoice.number)) {
    fail(
      DomainErrorCode.INVALID_INVOICE,
      `an invoice in ${invoice.status} must already carry a number`,
      { status: invoice.status },
    );
  }

  if (isMissing(invoice.lockedAt)) {
    fail(DomainErrorCode.INVALID_INVOICE, `an invoice in ${invoice.status} must have a lockedAt`, {
      status: invoice.status,
    });
  }

  if (
    invoice.versions !== undefined &&
    !invoice.versions.some((version) => version.version === 1)
  ) {
    fail(
      DomainErrorCode.INVALID_INVOICE,
      `an invoice in ${invoice.status} must have a version 1 snapshot`,
      { status: invoice.status },
    );
  }
}
