/**
 * Reading rows back — into the domain's `InvoiceTotals`, and into the JSON the API returns.
 *
 * The stored invoice is re-checked on the way out (`totalsAreConsistent`), which costs a few bigint
 * additions and catches the one class of corruption that matters: a total that no longer equals its
 * lines. The alternative — trusting whatever is in the row — is how a tax report and an invoice end up
 * disagreeing about the same document.
 *
 * Money crosses the API as **decimal strings of minor units** (`'4365'`), never as JSON numbers: the
 * browser and React Native both parse them with `@einv/shared`, and neither can round a string.
 */

import {
  formatQuantity,
  totalsAreConsistent,
  type InvoiceTotals,
  type TaxSummaryRow,
} from '@einv/shared';

import { formatCalendarDate, parseTaxSummary } from './mappers';

/** Machine decimals: a dot and no grouping, because this string is data, not a page. */
const MACHINE_DECIMALS = { decimalSeparator: '.', groupSeparator: '' } as const;

/** The columns the read paths select — a structural type, so a test can build one without a client. */
export type InvoiceLineRow = {
  readonly id: string;
  readonly position: number;
  readonly description: string;
  readonly quantityScaled: bigint;
  readonly unitPriceMinor: bigint;
  readonly lineDiscountMinor: bigint;
  readonly lineTotalMinor: bigint;
  readonly taxMinor: bigint;
  readonly taxRateId: string;
  readonly taxRatePercentSnapshot: string;
  readonly taxCategorySnapshot: string;
};

export type InvoiceRow = {
  readonly id: string;
  readonly companyId: string;
  readonly direction: string;
  readonly status: string;
  readonly currency: string;
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
  readonly captureSource: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lines?: readonly InvoiceLineRow[];
};

/** Rebuilds the domain's totals from the row, including the per-rate summary. */
export function toInvoiceTotals(row: InvoiceRow): InvoiceTotals {
  return {
    currency: row.currency as InvoiceTotals['currency'],
    subtotalMinor: row.subtotalMinor,
    lineDiscountMinor: row.lineDiscountMinor,
    documentDiscountMinor: row.documentDiscountMinor,
    taxMinor: row.taxMinor,
    totalMinor: row.totalMinor,
    paidMinor: row.paidMinor,
    payableMinor: row.payableMinor,
    taxSummary: parseTaxSummary(row.taxSummaryJson),
  };
}

/** True when the stored row still satisfies the identities of §4.4. */
export function rowTotalsAreConsistent(row: InvoiceRow): boolean {
  return totalsAreConsistent(toInvoiceTotals(row));
}

/** The per-rate rows, typed for callers that only need the VAT breakdown. */
export function taxSummaryOf(row: InvoiceRow): readonly TaxSummaryRow[] {
  return parseTaxSummary(row.taxSummaryJson);
}

/** The machine-form quantity the API sends: `25000n` → `'2.5'`. */
export function quantityText(quantityScaled: bigint): string {
  return formatQuantity(quantityScaled, MACHINE_DECIMALS);
}

export type InvoiceViewLine = {
  readonly id: string;
  readonly position: number;
  readonly description: string;
  /** 4 dp decimal string: `'2.5'`. */
  readonly quantity: string;
  readonly unitPriceMinor: string;
  readonly lineDiscountMinor: string;
  readonly lineTotalMinor: string;
  readonly taxMinor: string;
  readonly taxRateId: string;
  readonly taxRatePercent: string;
  readonly taxCategory: string;
};

/**
 * One VAT-rate row as JSON. The domain's `TaxSummaryRow` holds `bigint` minor units, which
 * `JSON.stringify` refuses — money crosses the API as decimal strings here too.
 */
export type InvoiceTaxSummaryRow = {
  readonly taxRateId: string;
  readonly name: string;
  readonly category: string;
  readonly ratePercent: string;
  readonly baseMinor: string;
  readonly taxMinor: string;
};

export type InvoiceView = {
  readonly id: string;
  readonly status: string;
  readonly direction: string;
  readonly currency: string;
  readonly invoiceNumber: string | null;
  readonly issueDate: string | null;
  readonly dueDate: string | null;
  readonly supplier: {
    readonly name: string;
    readonly vatNumber: string | null;
    readonly address: string | null;
    readonly countryCode: string | null;
  };
  readonly buyer: {
    readonly name: string | null;
    readonly vatNumber: string | null;
  };
  readonly notes: string | null;
  readonly totals: {
    readonly subtotalMinor: string;
    readonly lineDiscountMinor: string;
    readonly documentDiscountMinor: string;
    readonly taxMinor: string;
    readonly totalMinor: string;
    readonly paidMinor: string;
    readonly payableMinor: string;
    readonly taxSummary: readonly InvoiceTaxSummaryRow[];
  };
  readonly lines: readonly InvoiceViewLine[];
  readonly captureSource: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Reported by the read path, not stored: a `false` here is an incident, not a validation error. */
  readonly totalsConsistent: boolean;
};

/** The API's shape for one invoice: strings for money and quantities, ISO strings for dates. */
export function toInvoiceView(row: InvoiceRow): InvoiceView {
  const totals = toInvoiceTotals(row);

  return {
    id: row.id,
    status: row.status,
    direction: row.direction,
    currency: row.currency,
    invoiceNumber: row.invoiceNumber,
    issueDate: formatCalendarDate(row.issueDate),
    dueDate: formatCalendarDate(row.dueDate),
    supplier: {
      name: row.supplierName,
      vatNumber: row.supplierVatNumber,
      address: row.supplierAddress,
      countryCode: row.supplierCountryCode,
    },
    buyer: { name: row.buyerName, vatNumber: row.buyerVatNumber },
    notes: row.notes,
    totals: {
      subtotalMinor: row.subtotalMinor.toString(),
      lineDiscountMinor: row.lineDiscountMinor.toString(),
      documentDiscountMinor: row.documentDiscountMinor.toString(),
      taxMinor: row.taxMinor.toString(),
      totalMinor: row.totalMinor.toString(),
      paidMinor: row.paidMinor.toString(),
      payableMinor: row.payableMinor.toString(),
      taxSummary: totals.taxSummary.map((row) => ({
        taxRateId: row.taxRateId,
        name: row.name,
        category: row.category,
        ratePercent: row.ratePercent,
        baseMinor: row.baseMinor.toString(),
        taxMinor: row.taxMinor.toString(),
      })),
    },
    lines: (row.lines ?? []).map((line) => ({
      id: line.id,
      position: line.position,
      description: line.description,
      quantity: quantityText(line.quantityScaled),
      unitPriceMinor: line.unitPriceMinor.toString(),
      lineDiscountMinor: line.lineDiscountMinor.toString(),
      lineTotalMinor: line.lineTotalMinor.toString(),
      taxMinor: line.taxMinor.toString(),
      taxRateId: line.taxRateId,
      taxRatePercent: line.taxRatePercentSnapshot,
      taxCategory: line.taxCategorySnapshot,
    })),
    captureSource: row.captureSource,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    totalsConsistent: totalsAreConsistent(totals),
  };
}

/** The list row: enough to render a card on a phone, without the lines. */
export type InvoiceSummaryView = {
  readonly id: string;
  readonly status: string;
  readonly currency: string;
  readonly invoiceNumber: string | null;
  readonly supplierName: string;
  readonly issueDate: string | null;
  readonly totalMinor: string;
  readonly payableMinor: string;
  readonly lineCount: number;
  readonly createdAt: string;
};

export function toInvoiceSummaryView(
  row: Omit<InvoiceRow, 'lines'> & { readonly lines?: readonly InvoiceLineRow[] },
): InvoiceSummaryView {
  return {
    id: row.id,
    status: row.status,
    currency: row.currency,
    invoiceNumber: row.invoiceNumber,
    supplierName: row.supplierName,
    issueDate: formatCalendarDate(row.issueDate),
    totalMinor: row.totalMinor.toString(),
    payableMinor: row.payableMinor.toString(),
    lineCount: row.lines?.length ?? 0,
    createdAt: row.createdAt.toISOString(),
  };
}
