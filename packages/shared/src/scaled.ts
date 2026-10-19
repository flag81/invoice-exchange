/**
 * Exact decimal arithmetic for quantities and tax rates.
 *
 * Two things in an invoice are not integers: how much of something was sold (`2.5` hours, `0.125` kg)
 * and at what percentage it is taxed (`18`, `8.5`). Both are handled here as **scaled integers** —
 * `bigint` counts of `10^-4` units — rather than as floating point, so the arithmetic that ends up in
 * an invoice total is exact by construction.
 *
 * Both scales are 4 dp, which is the scale `InvoiceLine.quantity` is stored with (§4.3) and gives
 * sub-basis-point precision on rates. Why not `decimal.js`, which the stack table names: ADR 0001
 * decision 1 keeps this package dependency-free, and `decimal.js` would only be relaying integers
 * back to us — see ADR 0006 for the reasoning and the one place `Decimal` still appears (Prisma at
 * the database edge, converted to these integers on the way in).
 *
 * Parsing is strict: decimal strings only. No exponent notation, no thousands separators, no
 * whitespace, no `+`, no locale decimal comma. User input and locale display belong at the edges
 * (`src/format/`), and a value that arrives here in an ambiguous form is a bug worth failing on.
 */

import { DomainErrorCode, fail } from './errors';

/** Quantities: 4 dp (`2.5` → `25000n`). */
export const QUANTITY_SCALE = 4;

/** Tax rates and percentages: 4 dp (`8.5` → `85000n`). */
export const RATE_SCALE = 4;

/** Exported for the parsers and the tests that pin the accepted grammar. */
export const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new RangeError(`scale must be an integer in 0..18, received ${String(scale)}`);
  }
}

/** How `parseScaledDecimal` should describe the value it is parsing when it fails. */
export type ScaledParseOptions = {
  readonly scale: number;
  readonly code: DomainErrorCode;
  readonly label: string;
  /** Defaults to `false`: a negative quantity or rate is a bug, not a credit note. */
  readonly allowNegative?: boolean;
};

/**
 * Parses a plain decimal string into a scaled integer: `('2.5', { scale: 4 })` → `25000n`.
 *
 * Callers name the rule that was broken (`INVALID_QUANTITY`, `INVALID_RATE`, `INVALID_AMOUNT` for
 * money) while sharing one grammar and one code path, so quantity, rate and money all accept exactly
 * the same shape of string.
 */
export function parseScaledDecimal(input: string, options: ScaledParseOptions): bigint {
  const { scale, code, label, allowNegative = false } = options;
  assertScale(scale);

  const match = DECIMAL_PATTERN.exec(input);
  if (match === null) {
    fail(code, `${label} must be a plain decimal string such as "2.5", received "${input}"`, {
      input,
      scale,
    });
  }

  const sign = match[1] ?? '';
  if (sign === '-' && !allowNegative) {
    fail(code, `${label} may not be negative, received "${input}"`, { input });
  }

  const integerPart = match[2] ?? '0';
  const fractionPart = match[3] ?? '';

  if (fractionPart.length > scale) {
    fail(code, `${label} may have at most ${scale} decimal places, received "${input}"`, {
      input,
      scale,
    });
  }

  // String concatenation, not division: `'2' + '5000'` is the exact scaled representation of 2.5.
  const magnitude = BigInt(`${integerPart}${fractionPart.padEnd(scale, '0')}`);

  return sign === '-' ? -magnitude : magnitude;
}

/** Quantity for an invoice line: non-negative, at most 4 dp. */
export function parseQuantity(input: string): bigint {
  return parseScaledDecimal(input, {
    scale: QUANTITY_SCALE,
    code: DomainErrorCode.INVALID_QUANTITY,
    label: 'quantity',
  });
}

/**
 * Tax rate as a percentage: `0`–`100` inclusive, at most 4 dp. Negative rates are rejected rather
 * than treated as a credit: a credit note is a separate document (§4.5), not a negative rate.
 */
export function parseRate(input: string): bigint {
  const rate = parseScaledDecimal(input, {
    scale: RATE_SCALE,
    code: DomainErrorCode.INVALID_RATE,
    label: 'tax rate',
  });

  if (rate > 100n * 10n ** BigInt(RATE_SCALE)) {
    fail(DomainErrorCode.INVALID_RATE, `tax rate must not exceed 100, received "${input}"`, {
      input,
    });
  }

  return rate;
}

/**
 * Round-half-away-from-zero integer division — the single rounding rule in the domain (§4.4).
 *
 * "Half-up" is implemented as half *away from zero* so that a credit note's totals are the exact
 * negation of the invoice's rather than off by one minor unit: `round(2.5) = 3` and `round(-2.5) = -3`.
 * Every rounding decision in an invoice funnels through this function, which is what makes the totals
 * invariants provable instead of probable.
 */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    fail(DomainErrorCode.DIVISION_BY_ZERO, 'nuk mund të pjesëtohet me zero');
  }

  const negative = numerator < 0n !== denominator < 0n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;

  // Doubling the dividend lets integer division perform the half-up step without any float.
  const rounded = (absoluteNumerator * 2n + absoluteDenominator) / (absoluteDenominator * 2n);

  return negative ? -rounded : rounded;
}

/** Multiplies two scaled integers, rounding the result back to the same scale. */
export function multiplyScaled(left: bigint, right: bigint, scale: number): bigint {
  assertScale(scale);
  return divRoundHalfUp(left * right, 10n ** BigInt(scale));
}

/** Exact decimal string with a fixed number of places: `(-1234n, 2)` → `"-12.34"`. */
export function formatScaledDecimal(value: bigint, scale: number): string {
  assertScale(scale);

  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const integerPart = digits.slice(0, digits.length - scale);
  const fractionPart = scale === 0 ? '' : digits.slice(digits.length - scale);

  return `${negative ? '-' : ''}${integerPart}${scale === 0 ? '' : `.${fractionPart}`}`;
}
