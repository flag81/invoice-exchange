/**
 * Tax categories and rates.
 *
 * A rate is *data owned by a tenant* (`TaxRate` in §4.4), never a constant in the domain: the Kosovo
 * defaults (VAT 18 % / 8 %, plus the export rules) are seed rows, so supporting another country is a
 * data change rather than a release. What lives here is the part that must be identical everywhere:
 * the closed set of categories and what each one means for arithmetic.
 *
 * The category — not the percentage — decides whether tax exists. `ZERO`, `EXEMPT` and
 * `REVERSE_CHARGE` are all "no tax is charged on this line", but they are different facts on a legal
 * document, which is why they are separate values with the rate pinned to zero rather than one
 * category with a `0` rate.
 */

import { DomainErrorCode, fail } from './errors';
import { ZERO_MINOR, applyRate, type MinorUnits } from './money';
import { parseRate } from './scaled';

export const TaxCategory = {
  /** The headline rate: 18 % in Kosovo. */
  STANDARD: 'STANDARD',
  /** The reduced rate: 8 % in Kosovo. */
  REDUCED: 'REDUCED',
  /** Taxed at 0 % — a real rate, reported in the VAT summary. */
  ZERO: 'ZERO',
  /** Outside the scope of VAT (exports under the Kosovo rules). */
  EXEMPT: 'EXEMPT',
  /** The buyer accounts for the VAT; the supplier charges nothing. */
  REVERSE_CHARGE: 'REVERSE_CHARGE',
} as const;

export type TaxCategory = (typeof TaxCategory)[keyof typeof TaxCategory];

export const TAX_CATEGORIES: readonly TaxCategory[] = Object.values(TaxCategory);

const TAXABLE_CATEGORIES: readonly TaxCategory[] = [TaxCategory.STANDARD, TaxCategory.REDUCED];

export function isTaxCategory(value: unknown): value is TaxCategory {
  return typeof value === 'string' && (TAX_CATEGORIES as readonly string[]).includes(value);
}

/** Categories where a rate is charged. The other three are always zero, by definition. */
export function taxCategoryIsTaxable(category: TaxCategory): boolean {
  return TAXABLE_CATEGORIES.includes(category);
}

/**
 * A tax rate as the domain uses it, and as `InvoiceVersion.totalsJson` snapshots it: an invoice stays
 * reproducible years later even after the tenant edits or deletes the `TaxRate` row.
 */
export type TaxRate = {
  readonly id: string;
  readonly name: string;
  readonly category: TaxCategory;
  /** Percentage as a decimal string — `'18'`, `'8.5'`. A string, so no float can appear here. */
  readonly ratePercent: string;
  /** ISO 3166-1 alpha-2, when the rate is country-specific (`'XK'`). */
  readonly countryCode?: string;
};

/** Guard for rates that arrive as data (seeded rows, JSON snapshots, API payloads). */
export function isTaxRate(value: unknown): value is TaxRate {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Readonly<Record<string, unknown>>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    isTaxCategory(candidate.category) &&
    typeof candidate.ratePercent === 'string' &&
    (candidate.countryCode === undefined || typeof candidate.countryCode === 'string')
  );
}

/**
 * Validates a rate and returns it as a 4 dp scaled integer (`'8.5'` → `85000n`).
 *
 * Two rules are enforced here rather than trusted: the percentage is in `0..100`, and a category that
 * means "no tax" carries a rate of exactly zero. A `REVERSE_CHARGE` row with 18 % in it would otherwise
 * produce an invoice that is wrong in a way nobody notices until an audit.
 */
export function taxRateScaled(rate: TaxRate): bigint {
  if (!isTaxCategory(rate.category)) {
    fail(DomainErrorCode.INVALID_RATE, `kategori e panjohur e TVSH-së "${String(rate.category)}"`, {
      taxRateId: rate.id,
      category: String(rate.category),
    });
  }

  const scaled = parseRate(rate.ratePercent);

  if (!taxCategoryIsTaxable(rate.category) && scaled !== 0n) {
    fail(
      DomainErrorCode.INVALID_RATE,
      `tax category ${rate.category} must be recorded with a rate of 0, received "${rate.ratePercent}"`,
      { taxRateId: rate.id, category: rate.category, ratePercent: rate.ratePercent },
    );
  }

  return scaled;
}

/** Tax for one base amount: zero for the non-taxable categories, otherwise `round(base × rate)`. */
export function taxForBase(baseMinor: MinorUnits, rate: TaxRate): MinorUnits {
  const scaled = taxRateScaled(rate);

  return taxCategoryIsTaxable(rate.category) ? applyRate(baseMinor, scaled) : ZERO_MINOR;
}
