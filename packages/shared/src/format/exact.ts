/**
 * Exact decimal-string helpers shared by the formatters — and by the normalisation of user input.
 *
 * These are the string halves of the money pipeline, and they exist so that a *display* amount is never
 * produced by a floating-point formatting call: `Intl.NumberFormat`, `toFixed` and friends round binary
 * doubles, and an invoice amount must not be rounded twice (`docs/architecture.md` §4.4 rounds once, in
 * `scaled.divRoundHalfUp`). Grouping a string of digits is tedious but exact, so grouping is code here.
 *
 * The defaults are the Kosovo conventions — `1.234,56` — because that is the first market; `apps/web`
 * passes a locale's separators when rendering another one. Nothing in this file depends on ICU data, so
 * a Node build with whatever locale data cannot change an amount.
 *
 * The same functions run backwards for input: `toPlainDecimal` turns `1.234,56` into `1234.56` so the
 * strict parsers in `money.ts` and `scaled.ts` can accept what a human typed without loosening their
 * grammar.
 */

export type SeparatorOptions = {
  /** Between the integer part and the fraction. Defaults to `,`. */
  readonly decimalSeparator?: string;
  /** Between groups of three digits. Defaults to `.`. */
  readonly groupSeparator?: string;
};

export const DEFAULT_DECIMAL_SEPARATOR = ',';
export const DEFAULT_GROUP_SEPARATOR = '.';

/** Spaces of every width a keyboard or a spreadsheet might have inserted. */
const SPACE_PATTERN = /[\s\u00a0\u202f]/g;

/**
 * Splits a plain decimal string into its integer digits and exactly `scale` fraction digits.
 *
 * The input must already be plain (`-12.34`, `1234`) — what `money.toDecimalString` and
 * `scaled.formatScaledDecimal` produce. Padding and slicing on the string is what keeps this exact: no
 * `Number`, no `parseFloat`, no rounding.
 */
export function splitDecimal(value: string, scale: number): readonly [string, string] {
  const unsigned = value.startsWith('-') ? value.slice(1) : value;
  const dot = unsigned.indexOf('.');
  const integerPart = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fractionPart = dot === -1 ? '' : unsigned.slice(dot + 1);

  return [integerPart === '' ? '0' : integerPart, fractionPart.padEnd(scale, '0').slice(0, scale)];
}

/** `('1234567', '.')` → `'1.234.567'`. Expects digits only; the sign is the caller's business. */
export function groupThousands(digits: string, separator: string): string {
  let grouped = '';

  for (let index = 0; index < digits.length; index += 1) {
    const remainingAfter = digits.length - index - 1;
    grouped += digits[index] ?? '';

    if (remainingAfter > 0 && remainingAfter % 3 === 0) {
      grouped += separator;
    }
  }

  return grouped;
}

/** `('5000')` → `'5'`, `('0000')` → `''`: how `2.5000` becomes `2,5` without touching a float. */
export function trimTrailingZeros(fractionPart: string): string {
  return fractionPart.replace(/0+$/, '');
}

function assertDistinctSeparators(decimalSeparator: string, groupSeparator: string): void {
  if (decimalSeparator === groupSeparator) {
    throw new RangeError(
      `decimal and group separators must differ, both are "${decimalSeparator}"`,
    );
  }
}

/**
 * Normalises a number a human typed into the plain form the parsers accept: `'1.234,56'` → `'1234.56'`.
 *
 * It removes spaces (including the non-breaking and narrow spaces that come back from web pages and
 * clipboard data), removes the thousands separator and rewrites the decimal separator. It deliberately
 * does **not** validate: `money.parse` and `parseQuantity` remain the only things that decide whether a
 * value is a legal amount, so there is one grammar in the codebase rather than two.
 */
export function toPlainDecimal(value: string, options: SeparatorOptions = {}): string {
  const { decimalSeparator = DEFAULT_DECIMAL_SEPARATOR, groupSeparator = DEFAULT_GROUP_SEPARATOR } =
    options;

  assertDistinctSeparators(decimalSeparator, groupSeparator);

  const withoutSpaces = value.replace(SPACE_PATTERN, '');
  const withoutGroups = withoutSpaces.split(groupSeparator).join('');

  return decimalSeparator === '.' ? withoutGroups : withoutGroups.split(decimalSeparator).join('.');
}
