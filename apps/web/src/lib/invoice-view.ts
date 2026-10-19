/**
 * The shapes and the arithmetic the review screen needs — client-safe, so the browser and the server
 * agree by construction.
 *
 * This module is deliberately in `lib/` rather than in `server/`: it imports nothing but
 * `@einv/shared` (pure, dependency-free), so it runs unchanged in a client component. The preview
 * arithmetic further down is the *same* function the server calls on save (`computeTotals`) with the
 * same de-noising (`normaliseDecimalText`) — which is the entire reason the preview can be trusted: a
 * second implementation of the totals would eventually disagree with the first, and the review screen
 * is exactly where nobody would notice.
 *
 * What the preview is *not*: authority. The save endpoint re-parses the posted text and recomputes
 * everything, so a browser that lies about a number only gets a different answer, never a different row.
 */

import {
  computeTotals,
  formatQuantity,
  isCurrencyCode,
  isDomainError,
  normaliseDecimalText,
  parseAmount,
  parseQuantity,
  toDecimalString,
  type CurrencyCode,
  type DraftProblem,
  type InvoiceLineTotalsInput,
  type TaxRate,
} from '@einv/shared';

import { sq } from './copy/sq';

/** Machine decimals: a dot, no grouping — an input field's value, not a page's. */
const MACHINE_DECIMALS = { decimalSeparator: '.', groupSeparator: '' } as const;

export type DraftLineView = {
  readonly position: number;
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly lineDiscount: string;
  readonly taxRateId: string;
  readonly taxRatePercent: string;
  readonly lineTotal: string;
  readonly taxAmount: string;
  readonly printedLineTotal: string | null;
};

export type DraftTaxSummaryRowView = {
  readonly taxRateId: string;
  readonly name: string;
  readonly ratePercent: string;
  readonly category: string;
  readonly base: string;
  readonly taxAmount: string;
};

export type DraftView = {
  readonly currency: string;
  readonly defaultCurrency: string;
  readonly supplier: {
    readonly name: string | null;
    readonly vatNumber: string | null;
    readonly address: string | null;
    readonly countryCode: string | null;
  };
  readonly buyer: { readonly name: string | null; readonly vatNumber: string | null };
  readonly invoiceNumber: string | null;
  readonly issueDate: string | null;
  readonly dueDate: string | null;
  readonly notes: string | null;
  readonly documentDiscount: string;
  readonly lines: readonly DraftLineView[];
  readonly totals: {
    readonly subtotal: string;
    readonly lineDiscount: string;
    readonly documentDiscount: string;
    readonly tax: string;
    readonly total: string;
    readonly taxSummary: readonly DraftTaxSummaryRowView[];
  };
  readonly problems: readonly DraftProblem[];
  readonly isSaveable: boolean;
};

export type TaxRateOptionView = {
  readonly id: string;
  readonly label: string;
  readonly ratePercent: string;
  readonly category: string;
};

/** The editable copy of a draft: every field a string, exactly as the form holds it. */
export type ReviewLine = {
  readonly taxRateId: string;
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly lineDiscount: string;
};

export type ReviewForm = {
  readonly currency: string;
  readonly supplierName: string;
  readonly supplierVatNumber: string;
  readonly supplierAddress: string;
  readonly supplierCountryCode: string;
  readonly buyerName: string;
  readonly buyerVatNumber: string;
  readonly invoiceNumber: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly notes: string;
  readonly documentDiscount: string;
  readonly lines: readonly ReviewLine[];
};

/** The draft as an editable form, with every absent value as `''` rather than `null`. */
export function toReviewForm(draft: DraftView): ReviewForm {
  return {
    currency: draft.currency,
    supplierName: draft.supplier.name ?? '',
    supplierVatNumber: draft.supplier.vatNumber ?? '',
    supplierAddress: draft.supplier.address ?? '',
    supplierCountryCode: draft.supplier.countryCode ?? '',
    buyerName: draft.buyer.name ?? '',
    buyerVatNumber: draft.buyer.vatNumber ?? '',
    invoiceNumber: draft.invoiceNumber ?? '',
    issueDate: draft.issueDate ?? '',
    dueDate: draft.dueDate ?? '',
    notes: draft.notes ?? '',
    documentDiscount: draft.documentDiscount,
    lines: draft.lines.map((line) => ({
      taxRateId: line.taxRateId,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineDiscount: line.lineDiscount,
    })),
  };
}

/**
 * The invoice the review screen points at when the number is already stored — the shape both the
 * duplicate-check route and the `DUPLICATE_INVOICE` error details return, so the screen parses it once.
 */
export type DuplicateInvoice = {
  readonly id: string;
  readonly invoiceNumber: string | null;
  readonly supplierName: string;
  /** ISO calendar day (`2026-03-14`), as every date crosses this API. */
  readonly issueDate: string | null;
  /** Minor units as a decimal string: `'4225'`, never a JSON number. */
  readonly totalMinor: string;
  readonly currency: string;
};

function textField(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key];

  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Reads a duplicate from an untrusted payload, or `null` when it is not one.
 *
 * `null` rather than a thrown error: a malformed extra in a 409 body must not take the review screen
 * down — the save is still refused by the server, and the screen falls back to its plain message.
 */
export function toDuplicateInvoice(value: unknown): DuplicateInvoice | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Readonly<Record<string, unknown>>;
  const id = textField(record, 'id');
  const supplierName = textField(record, 'supplierName');
  const totalMinor = textField(record, 'totalMinor');
  const currency = textField(record, 'currency');

  if (id === null || supplierName === null || totalMinor === null || currency === null) {
    return null;
  }

  if (!/^\d+$/.test(totalMinor)) {
    return null;
  }

  return {
    id,
    supplierName,
    totalMinor,
    currency,
    invoiceNumber: textField(record, 'invoiceNumber'),
    issueDate: textField(record, 'issueDate'),
  };
}

export type PreviewTotals = {
  readonly subtotal: string;
  readonly tax: string;
  readonly total: string;
  /** Set when the fields do not parse *yet* — a half-typed price is not an error worth shouting about. */
  readonly error: string | null;
};

/** A field's text as a value the strict parser accepts, or `null` when there is no number in it. */
function fieldValue(text: string): string | null {
  const trimmed = text.trim();

  return trimmed === '' ? null : normaliseDecimalText(trimmed);
}

function amountField(text: string, currency: CurrencyCode, fallbackMinor: bigint): bigint {
  const value = fieldValue(text);

  return value === null ? fallbackMinor : parseAmount(value, currency);
}

/** `25000n` → `'2.5'`; the form's own quantity format. */
function quantityToText(quantityScaled: bigint): string {
  return formatQuantity(quantityScaled, MACHINE_DECIMALS);
}

/**
 * A preview failure, in Albanian.
 *
 * The domain's `code` is the machine contract and is never translated; the sentence is for the person
 * typing, so a negative quantity does not surface as an English rule with a stack-trace pedigree.
 */
function previewError(error: unknown): string {
  if (isDomainError(error)) {
    switch (error.code) {
      case 'INVALID_AMOUNT':
        return sq.preview.amount;
      case 'INVALID_QUANTITY':
        return sq.preview.quantity;
      case 'UNKNOWN_CURRENCY':
        return sq.preview.currency;
      default:
        return sq.preview.other(error.code);
    }
  }

  return error instanceof Error ? error.message : sq.preview.notANumber;
}

/**
 * The preview: the four formulas of §4.4, run in the browser as the user types.
 *
 * Anything that does not parse yields `error` and dashes rather than a wrong number — the same principle
 * the server follows, and the reason a half-typed `1,` shows nothing instead of `100`.
 */
export function previewTotals(form: ReviewForm, rates: readonly TaxRate[]): PreviewTotals {
  try {
    const currency: CurrencyCode = isCurrencyCode(form.currency) ? form.currency : 'EUR';

    const lines: InvoiceLineTotalsInput[] = form.lines.map((line) => {
      const rate = rates.find((candidate) => candidate.id === line.taxRateId);
      if (rate === undefined) {
        throw new Error(sq.lines.unknownRate(line.taxRateId));
      }

      const quantityScaled = parseQuantity(fieldValue(line.quantity) ?? '0');

      return {
        quantity: quantityToText(quantityScaled),
        unitPriceMinor: amountField(line.unitPrice, currency, 0n),
        lineDiscountMinor: amountField(line.lineDiscount, currency, 0n),
        taxRate: rate,
      };
    });

    const totals = computeTotals({
      currency,
      lines,
      documentDiscountMinor: amountField(form.documentDiscount, currency, 0n),
    });

    return {
      subtotal: toDecimalString(totals.subtotalMinor, currency),
      tax: toDecimalString(totals.taxMinor, currency),
      total: toDecimalString(totals.totalMinor, currency),
      error: null,
    };
  } catch (error) {
    return {
      subtotal: '—',
      tax: '—',
      total: '—',
      error: previewError(error),
    };
  }
}

/** What gets posted to `/api/invoices`: the reviewed text, plus where it came from. */
export function toSubmitPayload(
  form: ReviewForm,
  extras: { readonly extractionId: string | null; readonly captureSource: string },
): Record<string, unknown> {
  return {
    currency: form.currency,
    supplier: {
      name: form.supplierName,
      vatNumber: form.supplierVatNumber,
      address: form.supplierAddress,
      countryCode: form.supplierCountryCode,
    },
    buyer: { name: form.buyerName, vatNumber: form.buyerVatNumber },
    invoiceNumber: form.invoiceNumber,
    issueDate: form.issueDate,
    dueDate: form.dueDate,
    notes: form.notes,
    documentDiscount: form.documentDiscount,
    captureSource: extras.captureSource,
    extractionId: extras.extractionId,
    lines: form.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineDiscount: line.lineDiscount,
      taxRateId: line.taxRateId,
    })),
  };
}
