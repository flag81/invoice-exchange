/**
 * Mapping between the domain's draft and the database's rows — pure functions, no client.
 *
 * Keeping the mapping here, rather than inside the repository, is what makes it testable without a
 * database: a test asserts the exact row a draft becomes, and the repository stays a few lines long.
 *
 * Three rules the mapping enforces because a database cannot:
 *
 *   1. **`bigint` never reaches `JSON.stringify`.** `JSON.stringify({ total: 1n })` throws, so every
 *      amount that goes into a JSON column is written as a decimal string and parsed back with
 *      `BigInt(...)` on the way out. The API does the same, for the same reason: JSON has no integers
 *      wider than 2^53, and an invoice must not lose a cent to that.
 *   2. **A calendar date is built in UTC.** `new Date('2026-03-14')` is UTC midnight while
 *      `new Date(2026, 2, 14)` is local midnight — the second becomes the 13th in a negative-offset
 *      timezone. Dates are built explicitly in UTC, so the day printed on the paper is the day stored.
 *   3. **A rate is snapshotted.** The line keeps the percentage and the category it was taxed with, so
 *      editing the tenant's rate table cannot rewrite history.
 */

import {
  DomainError,
  DomainErrorCode,
  type CurrencyCode,
  type DraftParty,
  type InvoiceStatus,
  type NormalisedDraft,
  type TaxCategory,
  type TaxSummaryRow,
} from '@einv/shared';

/** Where the numbers came from; a support question ("why is this wrong?") starts with this. */
export const CaptureSource = {
  CAMERA: 'CAMERA',
  UPLOAD: 'UPLOAD',
  MANUAL: 'MANUAL',
} as const;

export type CaptureSource = (typeof CaptureSource)[keyof typeof CaptureSource];

export type InvoiceLineCreateData = {
  readonly position: number;
  readonly description: string;
  readonly quantityScaled: bigint;
  readonly unitPriceMinor: bigint;
  readonly lineDiscountMinor: bigint;
  readonly lineTotalMinor: bigint;
  readonly taxMinor: bigint;
  readonly taxRateId: string;
  readonly taxRatePercentSnapshot: string;
  readonly taxCategorySnapshot: TaxCategory;
};

export type InvoiceCreateData = {
  readonly companyId: string;
  readonly direction: 'PAYABLE';
  readonly status: InvoiceStatus;
  readonly currency: CurrencyCode;
  readonly invoiceNumber: string | null;
  readonly issueDate: Date | null;
  readonly dueDate: Date | null;
  readonly supplierName: string;
  readonly supplierVatNumber: string | null;
  readonly supplierAddress: string | null;
  readonly supplierCountryCode: string | null;
  readonly buyerName: string | null;
  readonly buyerVatNumber: string | null;
  readonly notes: string | null;
  readonly subtotalMinor: bigint;
  readonly lineDiscountMinor: bigint;
  readonly documentDiscountMinor: bigint;
  readonly taxMinor: bigint;
  readonly totalMinor: bigint;
  readonly paidMinor: bigint;
  readonly payableMinor: bigint;
  readonly taxSummaryJson: string;
  readonly captureSource: CaptureSource;
  /**
   * Mutable on purpose: Prisma's nested `create` input takes an array, and a `readonly` one is not
   * assignable to it. Nothing here mutates the array — the type simply has to match what the client
   * accepts, and a cast would hide a genuine mismatch instead.
   */
  readonly lines: { readonly create: InvoiceLineCreateData[] };
};

/** `2026-03-14` → a `Date` at UTC midnight, so no timezone can move the day. */
export function parseCalendarDate(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) {
    throw new DomainError(
      DomainErrorCode.INVALID_INVOICE,
      `"${isoDate}" nuk është një datë kalendarike`,
      {
        value: isoDate,
      },
    );
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/** The inverse: a `date` column read back as `YYYY-MM-DD`, without a locale in sight. */
export function formatCalendarDate(date: Date | null): string | null {
  if (date === null) {
    return null;
  }

  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/** Bigints as decimal strings — the only form JSON carries without losing precision. */
export function serialiseTaxSummary(rows: readonly TaxSummaryRow[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      taxRateId: row.taxRateId,
      name: row.name,
      category: row.category,
      ratePercent: row.ratePercent,
      baseMinor: row.baseMinor.toString(),
      taxMinor: row.taxMinor.toString(),
    })),
  );
}

/** Reads a stored summary back. A corrupt snapshot yields `[]`, which the invariants then reject. */
export function parseTaxSummary(json: string): readonly TaxSummaryRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const rows: TaxSummaryRow[] = [];

  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Readonly<Record<string, unknown>>;

    try {
      rows.push({
        taxRateId: String(record['taxRateId'] ?? ''),
        name: String(record['name'] ?? ''),
        category: record['category'] as TaxCategory,
        ratePercent: String(record['ratePercent'] ?? '0'),
        baseMinor: BigInt(String(record['baseMinor'] ?? '0')),
        taxMinor: BigInt(String(record['taxMinor'] ?? '0')),
      });
    } catch {
      return [];
    }
  }

  return rows;
}

/** The party columns, as the invoice table stores them (flat, snapshotted, no join needed). */
export function partyColumns(party: DraftParty): {
  readonly name: string | null;
  readonly vatNumber: string | null;
  readonly address: string | null;
  readonly countryCode: string | null;
} {
  return {
    name: party.name,
    vatNumber: party.vatNumber,
    address: party.address,
    countryCode: party.countryCode,
  };
}

/**
 * The draft as a `CREATE` payload. Throws a `DomainError` — not a validation message — when asked to
 * store a draft with no supplier name or no lines, because both are impossible through the UI (the
 * save button is disabled) and therefore mean the caller skipped its own check.
 */
export function toInvoiceCreateData(
  draft: NormalisedDraft,
  options: { readonly companyId: string; readonly captureSource: CaptureSource },
): InvoiceCreateData {
  const supplierName = draft.supplier.name;
  if (supplierName === null) {
    throw new DomainError(
      DomainErrorCode.INVALID_PARTY,
      'një faturë e kapur nuk mund të ruhet pa emrin e furnitorit',
    );
  }

  if (draft.lines.length === 0) {
    throw new DomainError(
      DomainErrorCode.INVALID_INVOICE,
      'një faturë e kapur nuk mund të ruhet pa rreshta',
    );
  }

  const supplier = partyColumns(draft.supplier);
  const buyer = partyColumns(draft.buyer);

  return {
    companyId: options.companyId,
    direction: 'PAYABLE',
    status: 'DRAFT',
    currency: draft.currency,
    invoiceNumber: draft.invoiceNumber,
    issueDate: draft.issueDate === null ? null : parseCalendarDate(draft.issueDate),
    dueDate: draft.dueDate === null ? null : parseCalendarDate(draft.dueDate),
    supplierName,
    supplierVatNumber: supplier.vatNumber,
    supplierAddress: supplier.address,
    supplierCountryCode: supplier.countryCode,
    buyerName: buyer.name,
    buyerVatNumber: buyer.vatNumber,
    notes: draft.notes,
    subtotalMinor: draft.totals.subtotalMinor,
    lineDiscountMinor: draft.totals.lineDiscountMinor,
    documentDiscountMinor: draft.totals.documentDiscountMinor,
    taxMinor: draft.totals.taxMinor,
    totalMinor: draft.totals.totalMinor,
    paidMinor: draft.totals.paidMinor,
    payableMinor: draft.totals.payableMinor,
    taxSummaryJson: serialiseTaxSummary(draft.totals.taxSummary),
    captureSource: options.captureSource,
    lines: {
      create: draft.lines.map((line) => ({
        position: line.position,
        description: line.description,
        quantityScaled: line.quantityScaled,
        unitPriceMinor: line.unitPriceMinor,
        lineDiscountMinor: line.lineDiscountMinor,
        lineTotalMinor: line.lineTotalMinor,
        taxMinor: line.taxMinor,
        taxRateId: line.taxRate.id,
        taxRatePercentSnapshot: line.taxRate.ratePercent,
        taxCategorySnapshot: line.taxRate.category,
      })),
    },
  };
}
