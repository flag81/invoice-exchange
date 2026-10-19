/**
 * Rendering the two decimal quantities in the domain: `InvoiceLine.quantity` (4 dp) and a tax rate
 * percentage (4 dp).
 *
 * Both live in `scaled.ts` as `bigint`s at the same scale, so both are rendered by the same code here —
 * `2.5` is stored as `25000n` and shown as `2,5`, `8.5 %` is stored as `85000n` and shown as `8,5`.
 *
 * Trailing zeros are trimmed by default, because `quantity: "2.5000"` on an invoice line is noise the
 * user did not type; set `trimTrailingZeros: false` for a tabular view where the decimal points must line
 * up. The percentage sign is deliberately *not* appended: `%` is a label the screen or the PDF places,
 * and `formatRate` returns the number those labels are attached to.
 */

import { RATE_SCALE, QUANTITY_SCALE, formatScaledDecimal } from '../scaled';
import {
  DEFAULT_DECIMAL_SEPARATOR,
  DEFAULT_GROUP_SEPARATOR,
  groupThousands,
  splitDecimal,
  trimTrailingZeros,
  type SeparatorOptions,
} from './exact';

export type DecimalFormatOptions = SeparatorOptions & {
  /** Defaults to `true`: `25000n` renders as `2,5` rather than `2,5000`. */
  readonly trimTrailingZeros?: boolean;
};

function formatScaledDecimalString(
  value: bigint,
  scale: number,
  options: DecimalFormatOptions,
): string {
  const { decimalSeparator = DEFAULT_DECIMAL_SEPARATOR, groupSeparator = DEFAULT_GROUP_SEPARATOR } =
    options;
  const trimZeros = options.trimTrailingZeros ?? true;

  const [integerPart, fractionPart] = splitDecimal(formatScaledDecimal(value, scale), scale);
  const grouped = groupThousands(integerPart, groupSeparator);
  const fraction = trimZeros ? trimTrailingZeros(fractionPart) : fractionPart;
  // `splitDecimal` returns digits only — the sign is the caller's business — so it is taken from the
  // value itself: `-15000n` renders as `-1,5`, never as `1,5`.
  const sign = value < 0n ? '-' : '';

  return fraction === '' ? `${sign}${grouped}` : `${sign}${grouped}${decimalSeparator}${fraction}`;
}

/** `25000n` → `'2,5'`; `2_000_000n` → `'200'`; `-15000n` → `'-1,5'`. */
export function formatQuantity(quantityScaled: bigint, options: DecimalFormatOptions = {}): string {
  return formatScaledDecimalString(quantityScaled, QUANTITY_SCALE, options);
}

/** `180000n` → `'18'`; `85000n` → `'8,5'`; `1000n` → `'0,1'`. */
export function formatRate(rateScaled: bigint, options: DecimalFormatOptions = {}): string {
  return formatScaledDecimalString(rateScaled, RATE_SCALE, options);
}
