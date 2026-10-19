/**
 * Provider output → the draft a human reviews.
 *
 * This is the function that decides what a photographed invoice *is*: it reads the model's answer
 * defensively, fills in nothing the paper did not say, and returns the draft together with the list of
 * things it had to assume. Nothing here writes to a database or renders anything — capture, extraction
 * and review are three steps precisely so that this one can be pure and exhaustively tested.
 *
 * Two behaviours are deliberate:
 *
 *   * a field the model omitted produces a *problem*, never a plausible default. A missing supplier
 *     name is an error (the invoice has no other side); a missing VAT number is a warning (plenty of
 *     suppliers print none).
 *   * the document's own currency wins over the tenant's default and the difference is reported
 *     (`CURRENCY_MISMATCH`). Converting a foreign invoice into the tenant's currency involves an
 *     exchange rate and a date, and that decision belongs to phase 6, not to a normaliser.
 */

import { isCurrencyCode, type CurrencyCode } from '../currency';
import { createDraftContext, finaliseDraft, resolveRate, type DraftLineInput } from './build';
import { parseInvoiceDate } from './dates';
import { asRecord, readFirstText, toRawInvoiceDocument } from './raw';
import {
  DraftProblemCode,
  type DraftParty,
  type DraftProblem,
  type NormaliseDraftOptions,
  type NormalisedDraft,
} from './types';
import { errorProblem, parseRateText, parseTaxCategoryWord, warningProblem } from './values';

const QUANTITY_KEYS = ['quantity', 'qty', 'units'] as const;
const UNIT_PRICE_KEYS = [
  'unitPrice',
  'price',
  'unitNetPrice',
  'unitPriceNet',
  'pricePerUnit',
] as const;
const LINE_DISCOUNT_KEYS = [
  'lineDiscount',
  'lineDiscountAmount',
  'discount',
  'discountAmount',
] as const;
const LINE_TOTAL_KEYS = ['lineTotal', 'netAmount', 'total', 'amountTotal'] as const;
const RATE_KEYS = ['taxRatePercent', 'taxRate', 'vatRate', 'ratePercent', 'rate'] as const;
const CATEGORY_KEYS = ['taxCategory', 'vatCategory', 'category'] as const;

function readProviderCurrency(
  declared: string | null,
  defaultCurrency: CurrencyCode,
  problems: DraftProblem[],
): CurrencyCode {
  const upper = declared === null ? null : declared.trim().toUpperCase();

  if (upper !== null && isCurrencyCode(upper)) {
    if (upper !== defaultCurrency) {
      problems.push(
        warningProblem(
          DraftProblemCode.CURRENCY_MISMATCH,
          `dokumenti është në ${upper}, kompania faturon në ${defaultCurrency}; përdoret monedha e dokumentit dhe nuk bëhet konvertim`,
          { field: 'currency' },
        ),
      );
    }

    return upper;
  }

  problems.push(
    warningProblem(
      DraftProblemCode.CURRENCY_NOT_FOUND,
      upper === null
        ? `nuk u lexua monedhë; u supozua ${defaultCurrency}`
        : `"${upper}" nuk është monedhë që njihet nga ky version; u supozua ${defaultCurrency}`,
      { field: 'currency' },
    ),
  );

  return defaultCurrency;
}

function readIssueDate(printed: string | null, problems: DraftProblem[]): string | null {
  const parsed = parseInvoiceDate(printed);

  if (parsed !== null) {
    return parsed;
  }

  problems.push(
    errorProblem(
      printed === null ? DraftProblemCode.MISSING_ISSUE_DATE : DraftProblemCode.UNREADABLE_DATE,
      printed === null
        ? 'data e lëshimit nuk u lexua; vendose përpara se të ruash'
        : `"${printed}" nuk është datë që lexohet nga ky version; korrigjoje përpara se të ruash`,
      { field: 'issueDate' },
    ),
  );

  return null;
}

function readDueDate(printed: string | null, problems: DraftProblem[]): string | null {
  const parsed = parseInvoiceDate(printed);

  if (parsed === null && printed !== null) {
    problems.push(
      warningProblem(
        DraftProblemCode.UNREADABLE_DATE,
        `afati i pagesës "${printed}" nuk u lexua; kushtet e pagesës mbeten të pacaktuara`,
        { field: 'dueDate' },
      ),
    );
  }

  return parsed;
}

/**
 * The entry point. `options` carries the tenant's currency and its own tax-rate rows, so the same
 * photograph normalises to the same numbers on the phone, in a test and in a batch job.
 */
export function normaliseExtractedInvoice(
  raw: unknown,
  options: NormaliseDraftOptions,
): NormalisedDraft {
  const context = createDraftContext(options);
  const problems: DraftProblem[] = [];
  const document = toRawInvoiceDocument(raw);

  if (asRecord(raw) === null) {
    problems.push(
      errorProblem(
        DraftProblemCode.NOT_A_DOCUMENT,
        'nxjerrja nuk ktheu një dokument; fotografo faturën përsëri',
      ),
    );
  }

  const currency = readProviderCurrency(document.currency, context.defaultCurrency, problems);

  const supplier: DraftParty = {
    name: document.supplierName,
    vatNumber: document.supplierVatNumber,
    address: document.supplierAddress,
    countryCode: document.supplierCountryCode,
  };
  const buyer: DraftParty = {
    name: document.buyerName,
    vatNumber: document.buyerVatNumber,
    address: null,
    countryCode: null,
  };

  if (supplier.name === null) {
    problems.push(
      errorProblem(
        DraftProblemCode.MISSING_SUPPLIER_NAME,
        'nuk u lexua emri i furnitorit; fatura nuk mund të ruhet pa të',
        { field: 'supplier.name' },
      ),
    );
  } else if (supplier.vatNumber === null) {
    problems.push(
      warningProblem(
        DraftProblemCode.MISSING_SUPPLIER_VAT_NUMBER,
        'nuk u lexua numri i TVSH-së i furnitorit; TVSH-ja e hyrjes nuk zbritet pa të',
        { field: 'supplier.vatNumber' },
      ),
    );
  }

  if (document.invoiceNumber === null) {
    problems.push(
      errorProblem(
        DraftProblemCode.MISSING_INVOICE_NUMBER,
        'numri i faturës së furnitorit nuk u lexua; shkruaje',
        { field: 'invoiceNumber' },
      ),
    );
  }

  const issueDate = readIssueDate(document.issueDate, problems);
  const dueDate = readDueDate(document.dueDate, problems);

  const keptLines = document.lines.slice(0, context.maxLines);
  if (document.lines.length > context.maxLines) {
    problems.push(
      warningProblem(
        DraftProblemCode.TOO_MANY_LINES,
        `u kthyen ${String(document.lines.length)} rreshta; u lexuan vetëm ${String(context.maxLines)} e parët`,
        { field: 'lines' },
      ),
    );
  }

  const lineInputs: readonly DraftLineInput[] = keptLines.map((line, lineIndex) => ({
    lineIndex,
    description: readFirstText(line, ['description', 'name', 'item', 'text']) ?? '',
    quantityText: readFirstText(line, QUANTITY_KEYS),
    unitPriceText: readFirstText(line, UNIT_PRICE_KEYS),
    lineDiscountText: readFirstText(line, LINE_DISCOUNT_KEYS),
    printedLineTotalText: readFirstText(line, LINE_TOTAL_KEYS),
    rate: resolveRate(
      context,
      parseRateText(readFirstText(line, RATE_KEYS)),
      parseTaxCategoryWord(readFirstText(line, CATEGORY_KEYS)),
      problems,
      `lines[${lineIndex}].taxRate`,
      lineIndex,
    ),
  }));

  return finaliseDraft(
    {
      supplier,
      buyer,
      invoiceNumber: document.invoiceNumber,
      issueDate,
      dueDate,
      notes: document.notes,
    },
    lineInputs,
    context,
    {
      currency,
      documentDiscountText: document.documentDiscount,
      printedTotalText: document.total,
      problems,
    },
  );
}
