/**
 * The raw document an extraction provider returns, before anything is trusted.
 *
 * Every field is `unknown`, and that is not laziness: this object came out of a language model reading
 * a photograph, so it is exactly as trustworthy as a request body from the internet. It is *parsed*,
 * never cast — `normalise.ts` reads each field through a narrow helper, and a value that is not the
 * expected shape becomes a reported problem rather than a wrong number on an invoice.
 *
 * The shape follows what a model can realistically read off paper: names, numbers and dates as they
 * were printed, in whatever locale the paper used (`1.234,56`, `14.03.2026`). Turning that into exact
 * integers is the normaliser's job, and it is why the parsed form is the only thing the app sees.
 */

/** An object with unknown values, as JSON that came from outside always is. */
export type UnknownRecord = Readonly<Record<string, unknown>>;

export function asRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as UnknownRecord;
}

/** Reads a field that should be text; trims it, and treats blank as absent. */
export function readText(record: UnknownRecord, key: string): string | null {
  const value = record[key];

  if (typeof value === 'string') {
    const trimmed = value.trim();

    return trimmed === '' ? null : trimmed;
  }

  // A model that answers with a number for a "text" field is common enough to be worth accepting.
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

/** Reads the first present key of several spellings — providers and prompts both drift. */
export function readFirstText(record: UnknownRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = readText(record, key);

    if (value !== null) {
      return value;
    }
  }

  return null;
}

/** Reads a field that should be a list of lines; a non-list is reported as "no lines". */
export function readArray(record: UnknownRecord, key: string): readonly unknown[] {
  const value = record[key];

  return Array.isArray(value) ? value : [];
}

/** The flattened, provider-independent view of an extraction result. */
export type RawInvoiceDocument = {
  readonly supplierName: string | null;
  readonly supplierVatNumber: string | null;
  readonly supplierAddress: string | null;
  readonly supplierCountryCode: string | null;
  readonly buyerName: string | null;
  readonly buyerVatNumber: string | null;
  readonly invoiceNumber: string | null;
  readonly issueDate: string | null;
  readonly dueDate: string | null;
  readonly currency: string | null;
  readonly documentDiscount: string | null;
  readonly total: string | null;
  readonly notes: string | null;
  readonly lines: readonly UnknownRecord[];
};

const SUPPLIER_KEYS = ['supplierName', 'supplier', 'sellerName', 'seller', 'vendorName'] as const;
const BUYER_KEYS = ['buyerName', 'buyer', 'customerName', 'customer', 'clientName'] as const;

/** Nested provider answers (`{ supplier: { name } }`) are flattened into the flat shape above. */
function recordOrSelf(value: unknown): UnknownRecord {
  return asRecord(value) ?? {};
}

export function toRawInvoiceDocument(value: unknown): RawInvoiceDocument {
  const root = asRecord(value) ?? {};
  const supplier = recordOrSelf(root['supplier']);
  const buyer = recordOrSelf(root['buyer']);

  return {
    supplierName: readFirstText(supplier, ['name']) ?? readFirstText(root, SUPPLIER_KEYS),
    supplierVatNumber:
      readFirstText(supplier, ['vatNumber', 'vat', 'taxId', 'fiscalNumber']) ??
      readFirstText(root, ['supplierVatNumber', 'sellerVatNumber']),
    supplierAddress:
      readFirstText(supplier, ['address']) ?? readFirstText(root, ['supplierAddress']),
    supplierCountryCode:
      readFirstText(supplier, ['countryCode', 'country']) ??
      readFirstText(root, ['supplierCountryCode']),
    buyerName: readFirstText(buyer, ['name']) ?? readFirstText(root, BUYER_KEYS),
    buyerVatNumber:
      readFirstText(buyer, ['vatNumber', 'vat', 'taxId']) ??
      readFirstText(root, ['buyerVatNumber']),
    invoiceNumber: readFirstText(root, ['invoiceNumber', 'number', 'invoiceNo', 'documentNumber']),
    issueDate: readFirstText(root, ['issueDate', 'date', 'invoiceDate']),
    dueDate: readFirstText(root, ['dueDate', 'paymentDueDate']),
    currency: readFirstText(root, ['currency', 'currencyCode']),
    documentDiscount: readFirstText(root, ['documentDiscount', 'discount']),
    total: readFirstText(root, ['total', 'totalAmount', 'grandTotal', 'amountDue']),
    notes: readFirstText(root, ['notes', 'note', 'comment']),
    lines: readArray(root, 'lines')
      .map((line) => asRecord(line))
      .filter((line): line is UnknownRecord => line !== null),
  };
}
