import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  DomainErrorCode,
  QUANTITY_SCALE,
  RATE_SCALE,
  formatQuantity,
  formatRate,
  formatScaledDecimal,
  parseScaledDecimal,
  toPlainDecimal,
} from '../index';

/** The inverse of `formatQuantity` / `formatRate`, at the same scale. */
function parseBack(plain: string, scale: number, label: string): bigint {
  return parseScaledDecimal(plain, {
    scale,
    code: DomainErrorCode.INVALID_QUANTITY,
    label,
    allowNegative: true,
  });
}

describe('formatQuantity', () => {
  it('renders a 4 dp quantity the way a person writes it', () => {
    expect(formatQuantity(25000n)).toBe('2,5');
    expect(formatQuantity(10000n)).toBe('1');
    expect(formatQuantity(0n)).toBe('0');
    expect(formatQuantity(1n)).toBe('0,0001');
    expect(formatQuantity(123456n)).toBe('12,3456');
    expect(formatQuantity(2000000n)).toBe('200');
    expect(formatQuantity(-15000n)).toBe('-1,5');
  });

  it('keeps the decimal places when a tabular view asks for them', () => {
    expect(formatQuantity(25000n, { trimTrailingZeros: false })).toBe('2,5000');
    expect(formatQuantity(2000000n, { trimTrailingZeros: false })).toBe('200,0000');
    expect(formatQuantity(0n, { trimTrailingZeros: false })).toBe('0,0000');
  });

  it('groups the integer part, so a long quantity stays readable', () => {
    expect(formatQuantity(123456789n)).toBe('12.345,6789');
    expect(formatQuantity(123456789n, { trimTrailingZeros: false })).toBe('12.345,6789');
  });

  it('renders another locale when it is told the separators', () => {
    expect(formatQuantity(25000n, { decimalSeparator: '.', groupSeparator: ',' })).toBe('2.5');
    expect(formatQuantity(123456789n, { decimalSeparator: '.', groupSeparator: ',' })).toBe(
      '12,345.6789',
    );
  });

  it('round-trips through the display form and back, for any quantity', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n }), (quantity) => {
        const displayed = formatQuantity(quantity, { trimTrailingZeros: false });

        expect(parseBack(toPlainDecimal(displayed), QUANTITY_SCALE, 'quantity')).toBe(quantity);
      }),
    );
  });
});

describe('formatRate', () => {
  it('renders a percentage as a number, leaving the sign to the label beside it', () => {
    expect(formatRate(180000n)).toBe('18');
    expect(formatRate(85000n)).toBe('8,5');
    expect(formatRate(1000n)).toBe('0,1');
    expect(formatRate(0n)).toBe('0');
    expect(formatRate(1000000n)).toBe('100');
    expect(formatRate(1n)).toBe('0,0001');
  });

  it('can hold the scale steady for a column of rates', () => {
    expect(formatRate(180000n, { trimTrailingZeros: false })).toBe('18,0000');
    expect(formatRate(0n, { trimTrailingZeros: false })).toBe('0,0000');
    expect(
      formatRate(85000n, { decimalSeparator: '.', groupSeparator: ',', trimTrailingZeros: false }),
    ).toBe('8.5000');
  });

  it('round-trips through the display form and back, for any rate', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 18n }), (rate) => {
        const displayed = formatRate(rate, { trimTrailingZeros: false });

        expect(parseBack(toPlainDecimal(displayed), RATE_SCALE, 'tax rate')).toBe(rate);
      }),
    );
  });
});

describe('the scale the formatters and the domain share', () => {
  it('is 4 dp for both quantities and rates, as §4.3 stores them', () => {
    expect(QUANTITY_SCALE).toBe(4);
    expect(RATE_SCALE).toBe(4);

    expect(formatScaledDecimal(25000n, QUANTITY_SCALE)).toBe('2.5000');
    expect(formatScaledDecimal(-15000n, RATE_SCALE)).toBe('-1.5000');
    expect(formatScaledDecimal(0n, RATE_SCALE)).toBe('0.0000');
  });

  it('means formatQuantity never hides a digit a stored value has', () => {
    const digits = '12345678901234567890';

    expect(formatQuantity(BigInt(digits))).toBe('1.234.567.890.123.456,789');
  });
});
