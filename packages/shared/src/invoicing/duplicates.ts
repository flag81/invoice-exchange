/**
 * When is a captured invoice the *same document* as one already stored?
 *
 * The product's most likely mistake is not a wrong number: it is the same paper captured twice — once
 * by the person who opened the envelope and once by whoever scanned the PDF, or the same photo
 * uploaded again after a dropped connection. Nothing on the review screen makes that visible, because
 * both captures look correct.
 *
 * The identity used here is the one a human uses when they leaf through a folder: **the supplier and
 * the number printed on the paper**. Not the file: a photograph and the supplier's PDF of the same
 * invoice are two different files, and an identical file is only a special case of the same paper.
 * Not the total either — a supplier can correct a total and keep the number, and that is still the same
 * invoice, for better or worse.
 *
 * Three rules make the comparison stable without making it clever:
 *
 *   1. **The number is normalised, not interpreted.** Surrounding and repeated whitespace is collapsed
 *      and the case is folded; punctuation is left alone, because `2026/0042` and `2026-0042` are two
 *      different numbers on two different papers until a human says otherwise. Guessing that they are
 *      the same is how a system silently refuses a legitimate invoice.
 *   2. **The supplier is its VAT number when it has one.** `811 234 567`, `XK811234567` and
 *      `811.234.567` are one taxpayer; the printed name is not, because the same company appears as
 *      `NPT Kafe Sh.p.k` and `NPT Kafe SH.P.K.`. Only when there is no usable VAT number does the
 *      normalised name stand in (letters and digits only, so `Sh.p.k` and `Shpk` are one name).
 *   3. **No number, no claim.** An invoice without a printed number cannot be identified by number, so
 *      it is never reported as a duplicate — a false accusation blocks a real invoice, and a missed one
 *      is what the review screen and the list are for.
 *
 * This module decides *identity* only. Whether a duplicate blocks a save, warns a human, or lands in a
 * report is the caller's decision (`@einv/db` refuses the write, the review screen shows the way to the
 * existing invoice).
 */

/** The columns of an invoice that its identity is built from — the stored snapshot, not a join. */
export type InvoiceIdentity = {
  /** The supplier's number, exactly as printed. */
  readonly invoiceNumber: string | null;
  /** The supplier's VAT number, as printed (punctuation and country prefix allowed). */
  readonly supplierVatNumber: string | null;
  /** The supplier's name, as printed. */
  readonly supplierName: string | null;
};

const WHITESPACE = /\s+/gu;
const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;
const NON_DIGIT = /\D+/gu;

/**
 * `' 2026-0042 '` and `'2026-0042'` are one number; `'2026  0042'` and `'2026 0042'` are one number.
 * `null` for a blank value, because "no number" must never equal another "no number".
 */
export function normaliseInvoiceNumber(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalised = value.trim().replace(WHITESPACE, ' ').toUpperCase();

  return normalised === '' ? null : normalised;
}

/**
 * A VAT number as digits, or `null` when there is nothing usable to compare.
 *
 * The three-digit floor is deliberate: `0`, `-` and `N/A` produce a digit string that would otherwise
 * make every malformed supplier look like every other one.
 */
export function normaliseVatNumber(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const digits = value.replace(NON_DIGIT, '');

  return digits.length >= 3 ? digits : null;
}

/**
 * A name with its punctuation, spacing and case removed: `NPT Kafe Sh.p.k.` → `NPTKAFESHPK`.
 *
 * Unicode-aware on purpose, so `Çeliku` stays `ÇELIKU` and does not collapse into `ELIKU` — stripping
 * the accent would merge two different companies, which is the one error this cannot afford.
 */
export function normaliseSupplierName(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalised = value.normalize('NFKC').replace(NON_ALPHANUMERIC, '').toUpperCase();

  return normalised === '' ? null : normalised;
}

/** The supplier half of the identity: the VAT number when it has one, the name otherwise. */
export function supplierIdentity(
  input: Pick<InvoiceIdentity, 'supplierVatNumber' | 'supplierName'>,
): string | null {
  return normaliseVatNumber(input.supplierVatNumber) ?? normaliseSupplierName(input.supplierName);
}

/**
 * The comparison key: `811234567#2026-0042`, or `null` when the invoice has no usable identity.
 *
 * `#` cannot appear in the supplier half (digits or letters only), so the two halves cannot be
 * ambiguous however many `#` characters the number happens to contain.
 */
export function invoiceIdentity(input: InvoiceIdentity): string | null {
  const number = normaliseInvoiceNumber(input.invoiceNumber);
  const supplier = supplierIdentity(input);

  return number === null || supplier === null ? null : `${supplier}#${number}`;
}

/** True when both values are identifiable and describe one paper. */
export function isSameInvoice(candidate: InvoiceIdentity, existing: InvoiceIdentity): boolean {
  const key = invoiceIdentity(candidate);

  return key !== null && key === invoiceIdentity(existing);
}

/**
 * The first existing invoice that is the same paper as `candidate`, or `null`.
 *
 * Order is the caller's: `@einv/db` asks the database for oldest-first, so the invoice a person is sent
 * back to is the original capture rather than the most recent copy of it.
 */
export function findDuplicate<T extends InvoiceIdentity>(
  candidate: InvoiceIdentity,
  existing: readonly T[],
): T | null {
  const key = invoiceIdentity(candidate);

  if (key === null) {
    return null;
  }

  for (const row of existing) {
    if (invoiceIdentity(row) === key) {
      return row;
    }
  }

  return null;
}
