/**
 * Invoice totals — the four formulas of §4.4, and the invariants they must satisfy.
 *
 * ```
 * lineTotalMinor = round(unitPriceMinor × quantity) − lineDiscountMinor
 * taxMinor       = round(lineTotalMinor × ratePercent), netted per tax category
 * totalMinor     = subtotalMinor + taxMinor − documentDiscountMinor
 * payableMinor   = totalMinor − sum(paymentsMinor)
 * ```
 *
 * This is the only place in the codebase where a document's totals are derived. The API, the PDF, the
 * tax report and the tests all call `computeTotals` — a second implementation is how two screens end up
 * disagreeing about the same invoice by one cent.
 *
 * Rounding happens **per line** and half away from zero (`scaled.divRoundHalfUp`), before summing, so
 * `subtotalMinor` is the sum of the amounts actually shown on the lines. The property tests in
 * `totals.test.ts` prove the identities hold for arbitrary inputs rather than for the examples someone
 * thought to try.
 *
 * Discounts are subtracted where the fiscal document has them: a line discount reduces that line's
 * taxable base, a document discount reduces the total without changing any line's tax. Allocating a
 * document discount across lines would need a method tax law does not define, so the domain refuses to
 * guess and keeps the two separate.
 */

import { type CurrencyCode } from './currency';
import { DomainErrorCode, fail } from './errors';
import {
  ZERO_MINOR,
  add,
  assertNonNegative,
  multiplyByQuantity,
  subtract,
  sum,
  type MinorUnits,
} from './money';
import { parseQuantity } from './scaled';
import { taxForBase, type TaxCategory, type TaxRate } from './tax';

/** One line, as the user typed it. Amounts are already minor units; `quantity` is a decimal string. */
export type InvoiceLineTotalsInput = {
  /** Correlates with `InvoiceLine.id`. Optional because totals are also computed for unsaved drafts. */
  readonly lineId?: string;
  /** `InvoiceLine.quantity`: a 4 dp decimal string, never a `number`. */
  readonly quantity: string;
  readonly unitPriceMinor: MinorUnits;
  /** Defaults to `0n`. Reduces this line's taxable base. */
  readonly lineDiscountMinor?: MinorUnits;
  /** The rate *as used*, snapshotted into the version — see `TaxRate`. */
  readonly taxRate: TaxRate;
};

export type InvoiceTotalsInput = {
  readonly currency: CurrencyCode;
  readonly lines: readonly InvoiceLineTotalsInput[];
  /** Header-level discount: reduces `totalMinor`, never a line's base. Defaults to `0n`. */
  readonly documentDiscountMinor?: MinorUnits;
  /** Recorded payments, so `payableMinor` can never disagree with them. Defaults to none. */
  readonly paymentsMinor?: readonly MinorUnits[];
};

/** One row of the VAT summary a tax authority (and the PDF) expects per rate. */
export type TaxSummaryRow = {
  readonly taxRateId: string;
  readonly name: string;
  readonly category: TaxCategory;
  readonly ratePercent: string;
  /** Sum of the lines taxed at this rate, after their own line discounts. */
  readonly baseMinor: MinorUnits;
  readonly taxMinor: MinorUnits;
};

export type InvoiceTotals = {
  readonly currency: CurrencyCode;
  readonly subtotalMinor: MinorUnits;
  /** Informational: the line discounts already deducted from `subtotalMinor`. */
  readonly lineDiscountMinor: MinorUnits;
  readonly documentDiscountMinor: MinorUnits;
  readonly taxMinor: MinorUnits;
  readonly totalMinor: MinorUnits;
  readonly paidMinor: MinorUnits;
  /** `totalMinor − paidMinor`; negative when the invoice was overpaid. */
  readonly payableMinor: MinorUnits;
  /** Sorted by rate id, so a snapshot written twice from the same lines is byte-identical. */
  readonly taxSummary: readonly TaxSummaryRow[];
};

type SummaryAccumulator = {
  readonly taxRateId: string;
  readonly name: string;
  readonly category: TaxCategory;
  readonly ratePercent: string;
  baseMinor: MinorUnits;
  taxMinor: MinorUnits;
};

/**
 * Derives every amount on the invoice, or fails with the rule that was broken. Nothing is clamped and
 * nothing is silently ignored: an impossible document (a discount larger than what it discounts) is a
 * `DomainError`, not a zero.
 */
export function computeTotals(input: InvoiceTotalsInput): InvoiceTotals {
  const documentDiscountMinor = input.documentDiscountMinor ?? ZERO_MINOR;
  const paymentsMinor = input.paymentsMinor ?? [];

  assertNonNegative(documentDiscountMinor, 'document discount');
  paymentsMinor.forEach((payment, index) => {
    assertNonNegative(payment, `payment ${index + 1}`);
  });

  let subtotalMinor = ZERO_MINOR;
  let lineDiscountMinor = ZERO_MINOR;
  const summary = new Map<string, SummaryAccumulator>();

  for (const line of input.lines) {
    assertNonNegative(line.unitPriceMinor, 'unit price');

    const grossMinor = multiplyByQuantity(line.unitPriceMinor, parseQuantity(line.quantity));
    const discountMinor = line.lineDiscountMinor ?? ZERO_MINOR;
    assertNonNegative(discountMinor, 'line discount');

    if (discountMinor > grossMinor) {
      fail(DomainErrorCode.INVALID_AMOUNT, 'a line discount may not exceed the line total', {
        lineId: line.lineId ?? null,
        grossMinor,
        discountMinor,
      });
    }

    const lineTotalMinor = subtract(grossMinor, discountMinor);
    const lineTaxMinor = taxForBase(lineTotalMinor, line.taxRate);
    const existing = summary.get(line.taxRate.id);

    if (existing === undefined) {
      summary.set(line.taxRate.id, {
        taxRateId: line.taxRate.id,
        name: line.taxRate.name,
        category: line.taxRate.category,
        ratePercent: line.taxRate.ratePercent,
        baseMinor: lineTotalMinor,
        taxMinor: lineTaxMinor,
      });
    } else {
      // One id must mean one rate: two percentages under the same id would make the summary a lie.
      if (existing.ratePercent !== line.taxRate.ratePercent) {
        fail(
          DomainErrorCode.INVALID_RATE,
          `tax rate "${line.taxRate.id}" was used with two different percentages`,
          {
            taxRateId: line.taxRate.id,
            firstPercent: existing.ratePercent,
            secondPercent: line.taxRate.ratePercent,
          },
        );
      }

      existing.baseMinor = add(existing.baseMinor, lineTotalMinor);
      existing.taxMinor = add(existing.taxMinor, lineTaxMinor);
    }

    subtotalMinor = add(subtotalMinor, lineTotalMinor);
    lineDiscountMinor = add(lineDiscountMinor, discountMinor);
  }

  if (documentDiscountMinor > subtotalMinor) {
    fail(DomainErrorCode.INVALID_AMOUNT, 'a document discount may not exceed the subtotal', {
      subtotalMinor,
      documentDiscountMinor,
    });
  }

  // Sorted, then summed: the tax total is the sum of the rows a tax authority will see, not an extra
  // parallel computation that could disagree with them by a cent.
  const taxSummary = [...summary.values()].sort((left, right) =>
    left.taxRateId.localeCompare(right.taxRateId),
  );
  const taxMinor = sum(taxSummary.map((row) => row.taxMinor));
  const totalMinor = subtract(add(subtotalMinor, taxMinor), documentDiscountMinor);
  const paidMinor = sum(paymentsMinor);

  return {
    currency: input.currency,
    subtotalMinor,
    lineDiscountMinor,
    documentDiscountMinor,
    taxMinor,
    totalMinor,
    paidMinor,
    payableMinor: subtract(totalMinor, paidMinor),
    taxSummary,
  };
}

/**
 * Re-checks a totals snapshot — the shape written to `InvoiceVersion.totalsJson` and read back years
 * later, when the code that produced it may no longer exist. Used by the invariant tests and by the
 * repository layer before a version row is inserted.
 */
export function totalsAreConsistent(totals: InvoiceTotals): boolean {
  const summaryBaseMinor = sum(totals.taxSummary.map((row) => row.baseMinor));
  const summaryTaxMinor = sum(totals.taxSummary.map((row) => row.taxMinor));

  return (
    summaryBaseMinor === totals.subtotalMinor &&
    summaryTaxMinor === totals.taxMinor &&
    totals.totalMinor === totals.subtotalMinor + totals.taxMinor - totals.documentDiscountMinor &&
    totals.payableMinor === totals.totalMinor - totals.paidMinor
  );
}

/** `totalsAreConsistent` as a guard: a mismatch means a corrupted snapshot, and it throws. */
export function assertTotalsConsistent(totals: InvoiceTotals): void {
  if (!totalsAreConsistent(totals)) {
    fail(
      DomainErrorCode.TOTALS_MISMATCH,
      'totalet nuk plotësojnë nëntotali + TVSH − zbritje = total',
      {
        subtotalMinor: totals.subtotalMinor,
        taxMinor: totals.taxMinor,
        documentDiscountMinor: totals.documentDiscountMinor,
        totalMinor: totals.totalMinor,
        paidMinor: totals.paidMinor,
        payableMinor: totals.payableMinor,
      },
    );
  }
}
