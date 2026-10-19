/**
 * Turning parsed values into the lines and totals of a draft invoice.
 *
 * Everything here is shared by the two callers that need it: `normalise.ts`, which reads a
 * *provider's* answer about a photograph, and `submission.ts`, which reads the *reviewed form* a human
 * just edited. Both must produce identical arithmetic, because a number that is right on the review
 * screen and wrong after saving is the worst possible bug in this product — so the line builder and
 * the totals come from here, and neither caller computes an amount itself.
 *
 * Rate choice is the only genuinely ambiguous decision in extraction. A printed `18 %` is matched
 * against the tenant's own `TaxRate` rows — never turned into a rate on the fly — and when nothing
 * matches, the fallback is taken **and reported** (`TAX_RATE_ASSUMED`). The review screen shows that
 * warning, because a wrong VAT rate is a tax problem, not a rounding problem.
 */

import { type CurrencyCode } from '../currency';
import { formatMoney } from '../format/money';
import { ZERO_MINOR, isNegative, multiplyByQuantity, subtract, type MinorUnits } from '../money';
import { QUANTITY_SCALE, RATE_SCALE, formatScaledDecimal } from '../scaled';
import { taxForBase, taxRateScaled, type TaxCategory, type TaxRate } from '../tax';
import { computeTotals, type InvoiceLineTotalsInput, type InvoiceTotals } from '../totals';
import {
  DraftProblemCode,
  type DraftParty,
  type DraftProblem,
  type NormaliseDraftOptions,
  type NormalisedDraft,
  type NormalisedDraftLine,
  type ResolvedRate,
} from './types';
import {
  attempt,
  errorProblem,
  parseMoneyText,
  parseQuantityText,
  quantityToText,
  warningProblem,
} from './values';

/** One quantity unit in the 4 dp scale: the value used when a line prints no quantity at all. */
const ONE_QUANTITY = 10n ** BigInt(QUANTITY_SCALE);

/** A document with more lines than this is not an invoice; the answer is probably a table dump. */
export const DEFAULT_MAX_LINES = 200;

/** Placeholder rate for a line nothing could be resolved for — always accompanied by an error. */
const UNRESOLVED_RATE: TaxRate = {
  id: 'unresolved',
  name: 'Pa normë TVSH-je',
  category: 'ZERO',
  ratePercent: '0',
};

export type RateEntry = {
  readonly rate: TaxRate;
  /** The rate as a scaled percentage, or `null` for a row that is not a legal rate at all. */
  readonly scaled: bigint | null;
};

export type DraftContext = {
  /** The tenant's currency — the fallback when the document does not state one. */
  readonly defaultCurrency: CurrencyCode;
  readonly rateEntries: readonly RateEntry[];
  /** Used when a printed rate matches nothing; `null` when the tenant has no usable rate. */
  readonly fallbackRate: TaxRate | null;
  readonly maxLines: number;
};

export function createDraftContext(options: NormaliseDraftOptions): DraftContext {
  const rateEntries: readonly RateEntry[] = options.taxRates.map((rate) => ({
    rate,
    scaled: attempt(() => taxRateScaled(rate)),
  }));

  const explicit =
    options.fallbackTaxRateId === undefined
      ? null
      : (rateEntries.find((entry) => entry.rate.id === options.fallbackTaxRateId) ?? null);

  const standards = rateEntries.filter((entry) => entry.rate.category === 'STANDARD');
  const singleStandard = standards.length === 1 ? standards[0] : undefined;

  return {
    defaultCurrency: options.defaultCurrency,
    rateEntries,
    fallbackRate: (explicit ?? singleStandard)?.rate ?? null,
    maxLines: options.maxLines ?? DEFAULT_MAX_LINES,
  };
}

export function matchRateByPercent(
  context: DraftContext,
  percentScaled: bigint,
  category: TaxCategory | null,
): TaxRate | null {
  const entry = context.rateEntries.find(
    (candidate) =>
      candidate.scaled === percentScaled &&
      (category === null || candidate.rate.category === category),
  );

  return entry?.rate ?? null;
}

/** Only a *unique* category match counts: two reduced rates would make the choice a coin toss. */
export function matchRateByCategory(context: DraftContext, category: TaxCategory): TaxRate | null {
  const matches = context.rateEntries.filter((entry) => entry.rate.category === category);

  return matches.length === 1 ? (matches[0]?.rate ?? null) : null;
}

function withPrintedCategory(
  rate: TaxRate,
  printedCategory: TaxCategory | null,
  problems: DraftProblem[],
  field: string,
  lineIndex: number,
): ResolvedRate {
  if (printedCategory !== null && printedCategory !== rate.category) {
    problems.push(
      warningProblem(
        DraftProblemCode.UNKNOWN_TAX_CATEGORY,
        `dokumenti shkruan kategorinë ${printedCategory}, por norma "${rate.name}" është ${rate.category}; fiton tabela e normave`,
        { field, lineIndex },
      ),
    );
  }

  return { rate, assumed: false, category: rate.category };
}

/**
 * Chooses the rate to charge by, in order: the printed percentage (with the printed category, then
 * without it), the printed category alone, the fallback rate, and finally nothing — which is an error,
 * because a line with no rate cannot be taxed correctly and must not be guessed at.
 */
export function resolveRate(
  context: DraftContext,
  percentScaled: bigint | null,
  printedCategory: TaxCategory | null,
  problems: DraftProblem[],
  field: string,
  lineIndex: number,
): ResolvedRate | null {
  if (percentScaled !== null) {
    const exact =
      matchRateByPercent(context, percentScaled, printedCategory) ??
      matchRateByPercent(context, percentScaled, null);

    if (exact !== null) {
      return withPrintedCategory(exact, printedCategory, problems, field, lineIndex);
    }
  } else if (printedCategory !== null) {
    const byCategory = matchRateByCategory(context, printedCategory);

    if (byCategory !== null) {
      return withPrintedCategory(byCategory, printedCategory, problems, field, lineIndex);
    }
  }

  const fallback = context.fallbackRate;
  if (fallback !== null) {
    const printed =
      percentScaled === null ? null : `${formatScaledDecimal(percentScaled, RATE_SCALE)} %`;

    problems.push(
      warningProblem(
        DraftProblemCode.TAX_RATE_ASSUMED,
        printed === null
          ? `norma e TVSH-së nuk u lexua; u supozua "${fallback.name}"`
          : `norma e shtypur ${printed} nuk përputhet me asnjë normë të kompanisë; u supozua "${fallback.name}"`,
        { field, lineIndex },
      ),
    );

    return { rate: fallback, assumed: true, category: fallback.category };
  }

  problems.push(
    errorProblem(
      DraftProblemCode.INVALID_TAX_RATE,
      'ky rresht nuk ka normë TVSH-je dhe kompania nuk ka asnjë për të supozuar; zgjidh një përpara se të ruash',
      { field, lineIndex },
    ),
  );

  return null;
}

export type DraftLineInput = {
  /** Zero-based, as the problem objects report it. */
  readonly lineIndex: number;
  readonly description: string;
  readonly quantityText: string | null;
  readonly unitPriceText: string | null;
  readonly lineDiscountText: string | null;
  readonly printedLineTotalText: string | null;
  readonly rate: ResolvedRate | null;
};

export type BuiltLine = {
  readonly line: NormalisedDraftLine;
  readonly problems: readonly DraftProblem[];
};

/**
 * Builds one line, reporting every problem it had to work around. The line is always returned: a
 * missing price gives a flagged `0` line rather than a dropped row, so the words on the paper survive
 * into the review screen and one unreadable field cannot make a whole invoice disappear.
 *
 * Quantities and prices that cannot be parsed fall back to a defined value (`1`, `0`) *and* raise an
 * `error`, which is what keeps the totals arithmetic well-defined while making sure nothing can be
 * saved until a human has looked at it.
 */
export function buildDraftLine(input: DraftLineInput, currency: CurrencyCode): BuiltLine {
  const problems: DraftProblem[] = [];
  const field = (name: string): string => `lines[${input.lineIndex}].${name}`;
  const lineIndex = input.lineIndex;

  let quantityScaled: bigint;
  if (input.quantityText === null) {
    quantityScaled = ONE_QUANTITY;
    problems.push(
      warningProblem(DraftProblemCode.QUANTITY_ASSUMED, 'nuk u shtyp sasi; u supozua 1', {
        field: field('quantity'),
        lineIndex,
      }),
    );
  } else {
    const parsedQuantity = parseQuantityText(input.quantityText);
    if (parsedQuantity === null) {
      quantityScaled = ONE_QUANTITY;
      problems.push(
        errorProblem(
          DraftProblemCode.INVALID_QUANTITY,
          `"${input.quantityText}" nuk është sasi; shfaqet 1 derisa ta korrigjosh`,
          { field: field('quantity'), lineIndex },
        ),
      );
    } else {
      quantityScaled = parsedQuantity;
    }
  }

  let unitPriceMinor = ZERO_MINOR;
  const parsedPrice =
    input.unitPriceText === null ? null : parseMoneyText(input.unitPriceText, currency);

  if (parsedPrice === null) {
    problems.push(
      errorProblem(
        DraftProblemCode.INVALID_UNIT_PRICE,
        input.unitPriceText === null
          ? 'për këtë rresht nuk u lexua çmim njësie; shkruaje'
          : `"${input.unitPriceText}" nuk është çmim në ${currency}; shkruaje`,
        { field: field('unitPrice'), lineIndex },
      ),
    );
  } else {
    unitPriceMinor = parsedPrice;
  }

  let lineDiscountMinor = ZERO_MINOR;
  if (input.lineDiscountText !== null) {
    const parsedDiscount = parseMoneyText(input.lineDiscountText, currency);
    if (parsedDiscount === null || isNegative(parsedDiscount)) {
      problems.push(
        warningProblem(
          DraftProblemCode.INVALID_LINE_DISCOUNT,
          `"${input.lineDiscountText}" nuk është zbritje; u supozua 0`,
          { field: field('lineDiscount'), lineIndex },
        ),
      );
    } else {
      lineDiscountMinor = parsedDiscount;
    }
  }

  const lineTotalMinor = subtract(
    multiplyByQuantity(unitPriceMinor, quantityScaled),
    lineDiscountMinor,
  );

  let taxMinor = ZERO_MINOR;
  const rate = input.rate;
  if (rate !== null) {
    const computedTax = attempt(() => taxForBase(lineTotalMinor, rate.rate));

    if (computedTax === null) {
      problems.push(
        errorProblem(
          DraftProblemCode.INVALID_TAX_RATE,
          'norma e TVSH-së e këtij rreshti nuk mund të zbatohet; kontrollo tabelën e normave',
          { field: field('taxRate'), lineIndex },
        ),
      );
    } else {
      taxMinor = computedTax;
    }
  }

  let printedLineTotalMinor: MinorUnits | null = null;
  if (input.printedLineTotalText !== null) {
    printedLineTotalMinor = parseMoneyText(input.printedLineTotalText, currency);

    if (printedLineTotalMinor !== null && printedLineTotalMinor !== lineTotalMinor) {
      problems.push(
        warningProblem(
          DraftProblemCode.PRINTED_LINE_TOTAL_MISMATCH,
          `fatura shtyp ${formatMoney(printedLineTotalMinor, currency)}, rreshti del ${formatMoney(lineTotalMinor, currency)}`,
          { field: field('lineTotal'), lineIndex },
        ),
      );
    }
  }

  return {
    line: {
      position: input.lineIndex + 1,
      description: input.description,
      quantity: quantityToText(quantityScaled),
      quantityScaled,
      unitPriceMinor,
      lineDiscountMinor,
      lineTotalMinor,
      taxMinor,
      taxRate: rate?.rate ?? UNRESOLVED_RATE,
      printedLineTotalMinor,
    },
    problems,
  };
}

export type DraftHeaderInput = {
  readonly supplier: DraftParty;
  readonly buyer: DraftParty;
  readonly invoiceNumber: string | null;
  readonly issueDate: string | null;
  readonly dueDate: string | null;
  readonly notes: string | null;
};

export type DraftExtras = {
  readonly currency: CurrencyCode;
  readonly documentDiscountText: string | null;
  readonly printedTotalText: string | null;
  /** Problems the caller already found (missing supplier, unreadable dates, truncated lines). */
  readonly problems: readonly DraftProblem[];
};

/** Zero totals with the right currency — used only if `computeTotals` itself were to refuse. */
function identityTotals(currency: CurrencyCode): InvoiceTotals {
  return {
    currency,
    subtotalMinor: ZERO_MINOR,
    lineDiscountMinor: ZERO_MINOR,
    documentDiscountMinor: ZERO_MINOR,
    taxMinor: ZERO_MINOR,
    totalMinor: ZERO_MINOR,
    paidMinor: ZERO_MINOR,
    payableMinor: ZERO_MINOR,
    taxSummary: [],
  };
}

/**
 * Assembles the draft: builds every line, applies the document discount, and derives the totals with
 * the one implementation the whole product uses (`computeTotals`).
 *
 * A document discount larger than the subtotal is refused with an *error* and treated as zero, rather
 * than passed to `computeTotals`, which rightly treats it as a programming error. A model that
 * misreads a discount as `1500` instead of `15,00` should produce a screen that asks a question, not
 * an exception.
 */
export function finaliseDraft(
  header: DraftHeaderInput,
  lineInputs: readonly DraftLineInput[],
  context: DraftContext,
  extras: DraftExtras,
): NormalisedDraft {
  const problems: DraftProblem[] = [...extras.problems];
  const built = lineInputs.map((input) => buildDraftLine(input, extras.currency));

  for (const item of built) {
    problems.push(...item.problems);
  }

  const lines = built.map((item) => item.line);

  if (lines.length === 0) {
    problems.push(
      errorProblem(DraftProblemCode.NO_LINES, 'nuk u lexua asnjë rresht i faturës; shtoji me dorë'),
    );
  }

  const subtotal = lines.reduce<MinorUnits>(
    (total, line) => total + line.lineTotalMinor,
    ZERO_MINOR,
  );

  let documentDiscountMinor = ZERO_MINOR;
  if (extras.documentDiscountText !== null) {
    const parsedDiscount = parseMoneyText(extras.documentDiscountText, extras.currency);

    if (parsedDiscount === null || isNegative(parsedDiscount)) {
      problems.push(
        warningProblem(
          DraftProblemCode.INVALID_DOCUMENT_DISCOUNT,
          `"${extras.documentDiscountText}" nuk është zbritje; u supozua 0`,
          { field: 'documentDiscount' },
        ),
      );
    } else if (parsedDiscount > subtotal) {
      problems.push(
        errorProblem(
          DraftProblemCode.INVALID_DOCUMENT_DISCOUNT,
          `zbritja ${formatMoney(parsedDiscount, extras.currency)} është më e madhe se nëntotali ${formatMoney(subtotal, extras.currency)}; shfaqet 0 derisa ta korrigjosh`,
          { field: 'documentDiscount' },
        ),
      );
    } else {
      documentDiscountMinor = parsedDiscount;
    }
  }

  const lineTotals: readonly InvoiceLineTotalsInput[] = lines.map((line) => ({
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
    lineDiscountMinor: line.lineDiscountMinor,
    taxRate: line.taxRate,
  }));

  const totals =
    attempt(() =>
      computeTotals({
        currency: extras.currency,
        lines: lineTotals,
        documentDiscountMinor,
      }),
    ) ?? identityTotals(extras.currency);

  let printedTotalMinor: MinorUnits | null = null;
  if (extras.printedTotalText !== null) {
    printedTotalMinor = parseMoneyText(extras.printedTotalText, extras.currency);

    if (printedTotalMinor !== null && printedTotalMinor !== totals.totalMinor) {
      problems.push(
        warningProblem(
          DraftProblemCode.PRINTED_TOTAL_MISMATCH,
          `fatura shtyp ${formatMoney(printedTotalMinor, extras.currency)} total, rreshtat mblidhen në ${formatMoney(totals.totalMinor, extras.currency)}`,
          { field: 'total' },
        ),
      );
    }
  }

  return {
    currency: extras.currency,
    defaultCurrency: context.defaultCurrency,
    supplier: header.supplier,
    buyer: header.buyer,
    invoiceNumber: header.invoiceNumber,
    issueDate: header.issueDate,
    dueDate: header.dueDate,
    notes: header.notes,
    documentDiscountMinor,
    printedTotalMinor,
    totals,
    lines,
    problems,
    isSaveable: lines.length > 0 && !problems.some((problem) => problem.severity === 'error'),
  };
}
