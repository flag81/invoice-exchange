/**
 * The draft as the *screen* sees it: money and quantities as decimal strings, in the machine form an
 * input field can hold.
 *
 * The domain's draft is bigints, and a bigint cannot cross JSON. Rather than send minor units and expect
 * the browser to divide by 100 (which is where the rounding bugs live), the server renders each amount
 * once, with `@einv/shared`'s formatters: `'12.50'` for a price, `'2.5'` for a quantity, `'43.65'` for a
 * total. The form posts the same strings straight back and `normaliseInvoiceSubmission` re-parses them,
 * so what the user saw, what they edited and what gets stored are the same text.
 *
 * The *types* live in `@/lib/invoice-view`, which the browser is allowed to import; this module is the
 * server-side implementation of them.
 */

import { formatQuantity, toDecimalString, type NormalisedDraft, type TaxRate } from '@einv/shared';

import type { DraftLineView, DraftView, TaxRateOptionView } from '@/lib/invoice-view';

/** Machine decimals: a dot, no grouping — this is data for an input field, not a page. */
const MACHINE_DECIMALS = { decimalSeparator: '.', groupSeparator: '' } as const;

/** The draft as JSON-safe data, with nothing rounded and nothing invented. */
export function toDraftView(draft: NormalisedDraft): DraftView {
  const currency = draft.currency;

  return {
    currency,
    defaultCurrency: draft.defaultCurrency,
    supplier: {
      name: draft.supplier.name,
      vatNumber: draft.supplier.vatNumber,
      address: draft.supplier.address,
      countryCode: draft.supplier.countryCode,
    },
    buyer: { name: draft.buyer.name, vatNumber: draft.buyer.vatNumber },
    invoiceNumber: draft.invoiceNumber,
    issueDate: draft.issueDate,
    dueDate: draft.dueDate,
    notes: draft.notes,
    documentDiscount: toDecimalString(draft.documentDiscountMinor, currency),
    lines: draft.lines.map((line): DraftLineView => ({
      position: line.position,
      description: line.description,
      quantity: formatQuantity(line.quantityScaled, MACHINE_DECIMALS),
      unitPrice: toDecimalString(line.unitPriceMinor, currency),
      lineDiscount: toDecimalString(line.lineDiscountMinor, currency),
      taxRateId: line.taxRate.id,
      taxRatePercent: line.taxRate.ratePercent,
      lineTotal: toDecimalString(line.lineTotalMinor, currency),
      taxAmount: toDecimalString(line.taxMinor, currency),
      printedLineTotal:
        line.printedLineTotalMinor === null
          ? null
          : toDecimalString(line.printedLineTotalMinor, currency),
    })),
    totals: {
      subtotal: toDecimalString(draft.totals.subtotalMinor, currency),
      lineDiscount: toDecimalString(draft.totals.lineDiscountMinor, currency),
      documentDiscount: toDecimalString(draft.totals.documentDiscountMinor, currency),
      tax: toDecimalString(draft.totals.taxMinor, currency),
      total: toDecimalString(draft.totals.totalMinor, currency),
      taxSummary: draft.totals.taxSummary.map((row) => ({
        taxRateId: row.taxRateId,
        name: row.name,
        ratePercent: row.ratePercent,
        category: row.category,
        base: toDecimalString(row.baseMinor, currency),
        taxAmount: toDecimalString(row.taxMinor, currency),
      })),
    },
    problems: draft.problems,
    isSaveable: draft.isSaveable,
  };
}

/** The rate table the review screen offers in its dropdowns (id + label, in domain order). */
export function toTaxRateOptions(rates: readonly TaxRate[]): readonly TaxRateOptionView[] {
  return rates.map((rate) => ({
    id: rate.id,
    label: `${rate.name} (${rate.ratePercent}%)`,
    ratePercent: rate.ratePercent,
    category: rate.category,
  }));
}
