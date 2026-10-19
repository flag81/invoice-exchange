/**
 * The shape of a captured invoice after normalisation — the contract between extraction, the review
 * screen and the database.
 *
 * Nothing here is a `number`: quantities and rates are 4 dp scaled integers with their decimal string,
 * money is minor units, and every field the paper did not provide is `null` rather than a plausible
 * guess. `problems` is the other half of the contract: the normaliser never silently repairs a
 * document, it reports what it had to assume so the review screen can put those fields in front of a
 * human. A draft is only `isSaveable` when every problem is a warning.
 */

import { type CurrencyCode } from '../currency';
import { type MinorUnits } from '../money';
import { type TaxCategory, type TaxRate } from '../tax';
import { type InvoiceTotals } from '../totals';

export const DraftProblemCode = {
  /** The provider answered with something that is not an invoice at all. */
  NOT_A_DOCUMENT: 'NOT_A_DOCUMENT',
  /** No supplier name: the invoice has no other side, so it cannot be filed. */
  MISSING_SUPPLIER_NAME: 'MISSING_SUPPLIER_NAME',
  /** A supplier VAT/fiscal number is required for a deductible input invoice (Kosovo VAT rules). */
  MISSING_SUPPLIER_VAT_NUMBER: 'MISSING_SUPPLIER_VAT_NUMBER',
  /** The supplier's own document number is how a duplicate is spotted. */
  MISSING_INVOICE_NUMBER: 'MISSING_INVOICE_NUMBER',
  MISSING_ISSUE_DATE: 'MISSING_ISSUE_DATE',
  /** A date was printed but in no format this build reads. */
  UNREADABLE_DATE: 'UNREADABLE_DATE',
  /** No currency on the paper: the tenant's default was used. */
  CURRENCY_NOT_FOUND: 'CURRENCY_NOT_FOUND',
  /** The document's currency is not the tenant's default — reported, never converted. */
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  NO_LINES: 'NO_LINES',
  /** More lines than the ceiling; the rest were dropped rather than truncated silently. */
  TOO_MANY_LINES: 'TOO_MANY_LINES',
  /** A line printed no quantity; `1` was assumed. */
  QUANTITY_ASSUMED: 'QUANTITY_ASSUMED',
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  INVALID_UNIT_PRICE: 'INVALID_UNIT_PRICE',
  INVALID_LINE_DISCOUNT: 'INVALID_LINE_DISCOUNT',
  INVALID_DOCUMENT_DISCOUNT: 'INVALID_DOCUMENT_DISCOUNT',
  INVALID_TAX_RATE: 'INVALID_TAX_RATE',
  /** The line's rate matched no tenant rate; the fallback rate was used. */
  TAX_RATE_ASSUMED: 'TAX_RATE_ASSUMED',
  /** The printed category is not one this build knows. */
  UNKNOWN_TAX_CATEGORY: 'UNKNOWN_TAX_CATEGORY',
  /** The printed line total disagrees with `round(unitPrice × quantity) − discount`. */
  PRINTED_LINE_TOTAL_MISMATCH: 'PRINTED_LINE_TOTAL_MISMATCH',
  /** The printed grand total disagrees with the sum of the lines. */
  PRINTED_TOTAL_MISMATCH: 'PRINTED_TOTAL_MISMATCH',
} as const;

export type DraftProblemCode = (typeof DraftProblemCode)[keyof typeof DraftProblemCode];

/**
 * `error` blocks saving — a human must supply the missing fact. `warning` never blocks: it records
 * something the normaliser decided, so the number in the database is explainable later.
 */
export type DraftProblemSeverity = 'error' | 'warning';

export type DraftProblem = {
  readonly code: DraftProblemCode;
  readonly severity: DraftProblemSeverity;
  readonly message: string;
  /** Dotted field path (`supplier.name`, `lines[2].unitPrice`) for the review screen. */
  readonly field?: string;
  /** Zero-based index into `lines`, when the problem belongs to one. */
  readonly lineIndex?: number;
};

export type NormalisedDraftLine = {
  /** 1-based, as printed. */
  readonly position: number;
  readonly description: string;
  /** 4 dp decimal string — the form `InvoiceLine.quantity` is stored in. */
  readonly quantity: string;
  readonly quantityScaled: bigint;
  readonly unitPriceMinor: MinorUnits;
  readonly lineDiscountMinor: MinorUnits;
  /** `round(unitPriceMinor × quantity) − lineDiscountMinor`. */
  readonly lineTotalMinor: MinorUnits;
  readonly taxMinor: MinorUnits;
  readonly taxRate: TaxRate;
  /** The total as printed on the paper, when the model reported one. */
  readonly printedLineTotalMinor: MinorUnits | null;
};

export type DraftParty = {
  readonly name: string | null;
  readonly vatNumber: string | null;
  readonly address: string | null;
  readonly countryCode: string | null;
};

export type NormalisedDraft = {
  readonly currency: CurrencyCode;
  /** The tenant's own currency, so the review screen can explain a `CURRENCY_MISMATCH`. */
  readonly defaultCurrency: CurrencyCode;
  readonly supplier: DraftParty;
  readonly buyer: DraftParty;
  readonly invoiceNumber: string | null;
  /** `YYYY-MM-DD`, or `null` when unreadable. */
  readonly issueDate: string | null;
  readonly dueDate: string | null;
  readonly notes: string | null;
  readonly documentDiscountMinor: MinorUnits;
  readonly printedTotalMinor: MinorUnits | null;
  readonly totals: InvoiceTotals;
  readonly lines: readonly NormalisedDraftLine[];
  readonly problems: readonly DraftProblem[];
  /** True when no problem has severity `error` and at least one line survived. */
  readonly isSaveable: boolean;
};

export type NormaliseDraftOptions = {
  /** The tenant's currency: the fallback when the paper does not state one. */
  readonly defaultCurrency: CurrencyCode;
  /** The tenant's tax rates (`TaxRate` rows), the only percentages arithmetic may use. */
  readonly taxRates: readonly TaxRate[];
  /** Used when a printed rate matches none of `taxRates`; see `TAX_RATE_ASSUMED`. */
  readonly fallbackTaxRateId?: string | undefined;
  /** Ceiling on lines, so one pathological answer cannot fill the database. Defaults to 200. */
  readonly maxLines?: number | undefined;
};

/** A category resolved from either a printed percentage or a printed category word. */
export type ResolvedRate = {
  readonly rate: TaxRate;
  /** True when the printed rate could not be matched and `fallbackTaxRateId` was used. */
  readonly assumed: boolean;
  readonly category: TaxCategory;
};
