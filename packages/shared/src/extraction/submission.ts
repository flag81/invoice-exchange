/**
 * The reviewed form → the same draft shape the provider output produces.
 *
 * The review screen is where a human corrects what the model read, and the payload it posts is
 * *text*: what the person typed, in the local format (`1.234,56`, `2,5`), with the tax rate chosen by
 * id from the company's own rate table. Parsing it here — with the same line builder the extraction
 * path uses — is what makes "what you saw is what gets saved" true rather than aspirational.
 *
 * The API route calls this and never trusts an integer from the browser: a client that posts
 * `unitPriceMinor: 1` gets a price of `0,01` only if the *text* said so. Amounts are the server's
 * arithmetic or they are nothing.
 */

import { isCurrencyCode, type CurrencyCode } from '../currency';
import { createDraftContext, finaliseDraft, type DraftLineInput } from './build';
import { parseInvoiceDate } from './dates';
import { asRecord, readArray, readFirstText, readText, type UnknownRecord } from './raw';
import {
  DraftProblemCode,
  type DraftParty,
  type DraftProblem,
  type NormaliseDraftOptions,
  type NormalisedDraft,
} from './types';
import { errorProblem, warningProblem } from './values';

function readParty(record: UnknownRecord | null): DraftParty {
  if (record === null) {
    return { name: null, vatNumber: null, address: null, countryCode: null };
  }

  return {
    name: readFirstText(record, ['name', 'supplierName', 'buyerName']),
    vatNumber: readFirstText(record, ['vatNumber', 'vat', 'taxId', 'fiscalNumber']),
    address: readFirstText(record, ['address']),
    countryCode: readFirstText(record, ['countryCode', 'country']),
  };
}

/**
 * Normalises a reviewed invoice. Every field is optional in the payload and every omission is
 * *reported*: the caller (the save route) refuses to store a draft whose problems contain an error, so
 * the rules live here once instead of being duplicated in the form and in the route.
 */
export function normaliseInvoiceSubmission(
  input: unknown,
  options: NormaliseDraftOptions,
): NormalisedDraft {
  const context = createDraftContext(options);
  const problems: DraftProblem[] = [];
  const payload = asRecord(input) ?? {};

  const declared = readFirstText(payload, ['currency']);
  const upper = declared === null ? null : declared.toUpperCase();
  let currency: CurrencyCode = context.defaultCurrency;

  if (upper !== null && isCurrencyCode(upper)) {
    currency = upper;
  } else {
    problems.push(
      warningProblem(
        DraftProblemCode.CURRENCY_NOT_FOUND,
        upper === null
          ? `formulari nuk dërgoi monedhë; u supozua ${context.defaultCurrency}`
          : `"${upper}" nuk është monedhë që njihet nga ky version; u supozua ${context.defaultCurrency}`,
        { field: 'currency' },
      ),
    );
  }

  const supplier = readParty(asRecord(payload['supplier']));
  const buyer = readParty(asRecord(payload['buyer']));

  if (supplier.name === null) {
    problems.push(
      errorProblem(
        DraftProblemCode.MISSING_SUPPLIER_NAME,
        'emri i furnitorit është i detyrueshëm',
        {
          field: 'supplier.name',
        },
      ),
    );
  }

  const invoiceNumber = readText(payload, 'invoiceNumber');
  if (invoiceNumber === null) {
    problems.push(
      errorProblem(
        DraftProblemCode.MISSING_INVOICE_NUMBER,
        'numri i faturës i furnitorit është i detyrueshëm',
        { field: 'invoiceNumber' },
      ),
    );
  }

  const issueDate = parseInvoiceDate(readText(payload, 'issueDate'));
  if (issueDate === null) {
    problems.push(
      errorProblem(DraftProblemCode.MISSING_ISSUE_DATE, 'data e lëshimit është e detyrueshme', {
        field: 'issueDate',
      }),
    );
  }

  const dueDate = parseInvoiceDate(readText(payload, 'dueDate'));
  const rawLines = readArray(payload, 'lines');
  const keptLines = rawLines
    .map((line) => asRecord(line))
    .filter((line): line is UnknownRecord => line !== null)
    .slice(0, context.maxLines);

  const lineInputs: readonly DraftLineInput[] = keptLines.map((line, lineIndex) => {
    const rateId = readFirstText(line, ['taxRateId']);
    const rate =
      rateId === null ? null : (options.taxRates.find((row) => row.id === rateId) ?? null);

    if (rate === null) {
      problems.push(
        errorProblem(
          DraftProblemCode.INVALID_TAX_RATE,
          rateId === null
            ? `rreshti ${String(lineIndex + 1)} nuk ka normë TVSH-je; zgjidh një`
            : `norma "${rateId}" nuk ekziston në këtë kompani; zgjidh një tjetër`,
          { field: `lines[${lineIndex}].taxRate`, lineIndex },
        ),
      );
    }

    return {
      lineIndex,
      description: readFirstText(line, ['description']) ?? '',
      quantityText: readFirstText(line, ['quantity']),
      unitPriceText: readFirstText(line, ['unitPrice']),
      lineDiscountText: readFirstText(line, ['lineDiscount']),
      printedLineTotalText: null,
      rate: rate === null ? null : { rate, assumed: false, category: rate.category },
    };
  });

  return finaliseDraft(
    { supplier, buyer, invoiceNumber, issueDate, dueDate, notes: readText(payload, 'notes') },
    lineInputs,
    context,
    {
      currency,
      documentDiscountText: readText(payload, 'documentDiscount'),
      printedTotalText: null,
      problems,
    },
  );
}
