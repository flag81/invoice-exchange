/**
 * Rendering money for humans — and only for humans.
 *
 * Everything here is `MinorUnits` in, `string` out. Nothing is parsed back, nothing rounds, and no
 * `Intl` call is involved, because an amount that has already been computed exactly must not be handed
 * to a formatter that would round a binary double (§4.4's single rounding rule lives in
 * `scaled.divRoundHalfUp`).
 *
 * The default rendering is the Kosovo convention with the ISO code:
 *
 * ```
 * formatMoney(123456n, 'EUR')                          → '1.234,56 EUR'
 * formatMoney(-50n, 'EUR')                             → '-0,50 EUR'
 * formatMoney(1234n, 'JPY')                            → '1.234 JPY'
 * formatMoney(123456n, 'EUR', { unit: '€' })           → '1.234,56 €'
 * formatMoney(123456n, 'EUR', { unit: '', decimalSeparator: '.', groupSeparator: ',' }) → '1,234.56'
 * ```
 *
 * The optional unit is a string rather than a `CurrencyDisplay` because a symbol is a presentation choice
 * (`€` versus `EUR` versus nothing on a PDF that already states the currency in a column header), and this
 * package has no opinion about which one a screen should use. It renders exactly what it is given.
 */

import { minorUnitExponent, type CurrencyCode } from '../currency';
import { absolute, isNegative, toDecimalString, type MinorUnits } from '../money';
import {
  DEFAULT_DECIMAL_SEPARATOR,
  DEFAULT_GROUP_SEPARATOR,
  groupThousands,
  splitDecimal,
  type SeparatorOptions,
} from './exact';

export type MoneyFormatOptions = SeparatorOptions & {
  /** Rendered after the amount, preceded by a space. Defaults to the ISO code; `''` for a bare number. */
  readonly unit?: string;
};

/** `123456n` + `EUR` → `'1.234,56 EUR'`. See the module comment for the options. */
export function formatMoney(
  amountMinor: MinorUnits,
  currency: CurrencyCode,
  options: MoneyFormatOptions = {},
): string {
  const {
    decimalSeparator = DEFAULT_DECIMAL_SEPARATOR,
    groupSeparator = DEFAULT_GROUP_SEPARATOR,
    unit = currency,
  } = options;

  const exponent = minorUnitExponent(currency);
  const [integerPart, fractionPart] = splitDecimal(
    toDecimalString(absolute(amountMinor), currency),
    exponent,
  );

  const grouped = groupThousands(integerPart, groupSeparator);
  const amount = exponent === 0 ? grouped : `${grouped}${decimalSeparator}${fractionPart}`;
  const signed = `${isNegative(amountMinor) ? '-' : ''}${amount}`;

  return unit === '' ? signed : `${signed} ${unit}`;
}
