/**
 * Money: an integer count of minor units.
 *
 * `12.34 EUR` is `1234n`, never `12.34`. Every amount in the domain, the database and the API is this
 * type, and the currency — not a decimal point — decides how many places the integer implies (`EUR` 2,
 * `JPY` 0, `KWD` 3). That is why parsing and rendering take a currency and the arithmetic does not.
 *
 * Arithmetic assumes all operands share a currency: a `bigint` cannot carry that fact, and wrapping it
 * in a class would move the check without performing it. The edges where currencies can actually mix
 * (a payment against an invoice, a credit note against its original) compare `Invoice.currency`
 * explicitly in phase 4.
 *
 * Nothing here rounds except `multiplyByQuantity` and `applyRate`, and both delegate to the single
 * rounding rule in `scaled.ts`. Those two functions are the only doors through which a non-integer can
 * enter invoice arithmetic: `unitPriceMinor × quantity` and `base × ratePercent`. Rounding half away
 * from zero, per line, before summing, is what makes the totals invariants provable (§4.4).
 */

import { minorUnitExponent, type CurrencyCode } from './currency';
import { DomainErrorCode, fail } from './errors';
import {
  RATE_SCALE,
  QUANTITY_SCALE,
  divRoundHalfUp,
  formatScaledDecimal,
  parseScaledDecimal,
} from './scaled';

/** A whole number of the currency's smallest unit: cents for EUR, yen for JPY, fils for KWD. */
export type MinorUnits = bigint;

export const ZERO_MINOR: MinorUnits = 0n;

export function isMinorUnits(value: unknown): value is MinorUnits {
  return typeof value === 'bigint';
}

/**
 * Parses a *major*-unit decimal string into minor units: `parseAmount('12.34', 'EUR')` → `1234n`.
 *
 * The string is what a human or a CSV wrote, so the currency is required to interpret it; more places
 * than the currency has (`'1.234'` for EUR) are rejected rather than rounded away, because silently
 * dropping a digit is how a cent goes missing. It is named `parseAmount` rather than `parse` because the
 * package barrel is flat and `parse` alone would say nothing next to `parseQuantity` and `parseRate`.
 *
 * Free-form input (`1.234,56`) is normalised first with `format.toPlainDecimal` — one grammar, applied
 * at the edge.
 */
export function parseAmount(input: string, currency: CurrencyCode): MinorUnits {
  return parseScaledDecimal(input, {
    scale: minorUnitExponent(currency),
    code: DomainErrorCode.INVALID_AMOUNT,
    label: `amount in ${currency}`,
    allowNegative: true,
  });
}

/** Exact plain decimal string, the inverse of `parse`: `(1234n, 'EUR')` → `'12.34'`. */
export function toDecimalString(minor: MinorUnits, currency: CurrencyCode): string {
  return formatScaledDecimal(minor, minorUnitExponent(currency));
}

export function add(left: MinorUnits, right: MinorUnits): MinorUnits {
  return left + right;
}

export function subtract(minuend: MinorUnits, subtrahend: MinorUnits): MinorUnits {
  return minuend - subtrahend;
}

export function negate(amount: MinorUnits): MinorUnits {
  return -amount;
}

export function absolute(amount: MinorUnits): MinorUnits {
  return amount < 0n ? -amount : amount;
}

/** Sums any number of amounts (including none, which is `0n`) — the only way totals are aggregated. */
export function sum(amounts: readonly MinorUnits[]): MinorUnits {
  let total = ZERO_MINOR;

  for (const amount of amounts) {
    total += amount;
  }

  return total;
}

/** `-1`, `0` or `1`, so callers never compare bigints with `<` and forget the equal case. */
export function compare(left: MinorUnits, right: MinorUnits): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}

export function isZero(amount: MinorUnits): boolean {
  return amount === ZERO_MINOR;
}

export function isNegative(amount: MinorUnits): boolean {
  return amount < ZERO_MINOR;
}

/**
 * Guards the "an amount on an invoice is not negative" rules (unit prices, discounts, payments).
 * A credit note is a separate document (§4.5), so a negative amount reaching one of these fields is a
 * bug, not a business case.
 */
export function assertNonNegative(amount: MinorUnits, label: string): void {
  if (amount < ZERO_MINOR) {
    fail(DomainErrorCode.INVALID_AMOUNT, `${label} may not be negative`, { label, amount });
  }
}

/**
 * `unitPriceMinor × quantity`, rounded half away from zero to the cent — the per-line gross amount of
 * `§4.4`. Quantities are 4 dp scaled integers, so the rounding is exact integer division.
 */
export function multiplyByQuantity(unitPriceMinor: MinorUnits, quantityScaled: bigint): MinorUnits {
  return divRoundHalfUp(unitPriceMinor * quantityScaled, 10n ** BigInt(QUANTITY_SCALE));
}

/**
 * `base × ratePercent ÷ 100`, rounded half away from zero — the per-line tax of `§4.4`.
 *
 * `rateScaled` counts `10^-4` of a *percent* (`'18'` → `180000n`), so one whole unit of the base is
 * `100 × 10^4` of them. Dividing by the bare rate scale here would charge 18 × the base instead of
 * 18 % of it, which is the mistake this constant exists to make impossible.
 */
const RATE_DIVISOR = 100n * 10n ** BigInt(RATE_SCALE);

export function applyRate(baseMinor: MinorUnits, rateScaled: bigint): MinorUnits {
  return divRoundHalfUp(baseMinor * rateScaled, RATE_DIVISOR);
}
