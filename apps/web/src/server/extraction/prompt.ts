/**
 * The instruction given to the vision model.
 *
 * It is written as a contract, not a wish, because everything downstream depends on it: the field names
 * are the ones `@einv/shared`'s reader looks for, numbers must be machine-readable (`1234.56`, never
 * `1.234,56`), and the model is told to answer `null` rather than to guess. A model that invents a
 * plausible VAT number is worse than one that admits it could not read it — the review screen exists to
 * fix the second case, and nothing can fix the first.
 *
 * The prompt also forbids computing totals: `computeTotals` is the only arithmetic in this product, and
 * a model that "helps" by adding up the lines would produce a second, disagreeing answer.
 *
 * It names both input kinds — a photograph and a PDF — because a PDF may hold several pages, and a model
 * that reads only the first page returns a plausible, incomplete invoice. That is the failure mode this
 * product must not have.
 */

export const EXTRACTION_PROMPT = `You read an invoice (a supplier invoice, a receipt, a delivery note or the same document as an emailed PDF) and return its content as JSON.

The input is either a photograph, a scan or a PDF file. If it is a PDF, read every page — a multi-page invoice prints its lines across pages, and the totals usually sit on the last one. Treat the pages as one document, not as several documents.

Return ONLY a JSON object. No prose, no markdown, no code fences.

The object must have exactly these fields (omit nothing; use null when a field is not on the document):

{
  "supplierName": string|null,          // the business that ISSUED the document, as printed
  "supplierVatNumber": string|null,     // its VAT / fiscal / business number, digits as printed
  "supplierAddress": string|null,
  "supplierCountryCode": string|null,   // ISO 3166-1 alpha-2, e.g. "XK"
  "buyerName": string|null,             // the business the document is addressed to
  "buyerVatNumber": string|null,
  "invoiceNumber": string|null,         // the supplier's own document number, exactly as printed
  "issueDate": string|null,             // see the date rule below
  "dueDate": string|null,
  "currency": string|null,              // ISO 4217 code, e.g. "EUR"
  "lines": [                            // one entry per printed line, in printed order
    {
      "description": string,            // the item text; "" if unreadable
      "quantity": string|null,          // machine number, e.g. "3" or "2.5"
      "unitPrice": string|null,         // price for ONE unit, machine number, e.g. "12.50"
      "lineDiscount": string|null,      // discount on this line, machine number, e.g. "1.00"
      "lineTotal": string|null,         // the line total AS PRINTED, machine number
      "taxRatePercent": string|null,    // e.g. "18" or "8"
      "taxCategory": string|null        // STANDARD | REDUCED | ZERO | EXEMPT | REVERSE_CHARGE
    }
  ],
  "documentDiscount": string|null,      // header-level discount, machine number
  "total": string|null,                 // the grand total AS PRINTED, machine number
  "notes": string|null                  // any payment terms or remarks worth keeping
}

Rules you must follow:
1. Numbers: plain machine format with a dot as the decimal separator and NO thousands separators. "1234.56", never "1.234,56" or "1,234.56". Do not add currency symbols.
2. Dates: "YYYY-MM-DD" when you can tell the day, otherwise the date exactly as printed (for example "14.03.2026"). Never invent a date.
3. Copy what the paper says. Do not compute, correct, convert or round anything: do not calculate line totals, do not sum lines, do not convert currencies, do not translate descriptions.
4. If the image is not an invoice, or is unreadable, return {"supplierName": null, "invoiceNumber": null, "issueDate": null, "currency": null, "lines": [], "total": null}.
5. Do not include any field other than the ones listed above.
6. Transcribe names and text exactly as printed, including Albanian letters (ë, ç) and legal suffixes such as "SH.P.K.". Never add, drop or substitute a character from another alphabet or encoding — a company name is an identity, and "SH.P.Š." is not "SH.P.K.".`;
