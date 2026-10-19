import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  DECIMAL_PATTERN,
  DomainErrorCode,
  QUANTITY_SCALE,
  RATE_SCALE,
  divRoundHalfUp,
  formatScaledDecimal,
  multiplyScaled,
  parseQuantity,
  parseRate,
  parseScaledDecimal,
  type ScaledParseOptions,
} from './index';
import { expectDomainError } from './testing/domain-error';

const amountOptions: ScaledParseOptions = {
  scale: 2,
  code: DomainErrorCode.INVALID_AMOUNT,
  label: 'amount',
};

describe('parseQuantity', () => {
  it('scales a decimal string into an exact 4 dp integer', () => {
    expect(QUANTITY_SCALE).toBe(4);
    expect(parseQuantity('2.5')).toBe(25000n);
    expect(parseQuantity('0.125')).toBe(1250n);
    expect(parseQuantity('12.3456')).toBe(123456n);
    expect(parseQuantity('7')).toBe(70000n);
    expect(parseQuantity('0')).toBe(0n);
    expect(parseQuantity('0.0001')).toBe(1n);
  });

  it('rejects anything that is not a plain, non-negative decimal', () => {
    const rejected = ['', 'abc', '2,5', '1e3', ' 2.5', '+2.5', '-1', '2.5.5', '.5', '1 000'];

    for (const input of rejected) {
      expectDomainError(() => parseQuantity(input), DomainErrorCode.INVALID_QUANTITY);
    }
  });

  it('refuses more decimals than the scale has, instead of rounding a digit away', () => {
    const error = expectDomainError(
      () => parseQuantity('0.00001'),
      DomainErrorCode.INVALID_QUANTITY,
    );

    expect(error.message).toContain('quantity');
    expect(error.details).toEqual({ input: '0.00001', scale: QUANTITY_SCALE });
  });
});

describe('parseRate', () => {
  it('parses a percentage with up to 4 decimals', () => {
    expect(RATE_SCALE).toBe(4);
    expect(parseRate('18')).toBe(180000n);
    expect(parseRate('8.5')).toBe(85000n);
    expect(parseRate('0.0001')).toBe(1n);
    expect(parseRate('0')).toBe(0n);
    expect(parseRate('100')).toBe(1000000n);
  });

  it('rejects negatives and anything above 100 %', () => {
    expectDomainError(() => parseRate('-1'), DomainErrorCode.INVALID_RATE);
    expectDomainError(() => parseRate('100.0001'), DomainErrorCode.INVALID_RATE);
    expectDomainError(() => parseRate('not a percentage'), DomainErrorCode.INVALID_RATE);
  });
});

describe('parseScaledDecimal', () => {
  it('shares one grammar between money, quantities and rates', () => {
    expect(parseScaledDecimal('12.34', amountOptions)).toBe(1234n);
    expect(parseScaledDecimal('12', amountOptions)).toBe(1200n);
    expect(parseScaledDecimal('-12.34', { ...amountOptions, allowNegative: true })).toBe(-1234n);
  });

  it('rejects a negative value unless the caller asked for one', () => {
    const error = expectDomainError(
      () => parseScaledDecimal('-12.34', amountOptions),
      DomainErrorCode.INVALID_AMOUNT,
    );

    expect(error.message).toContain('amount');
  });

  it('treats a scale outside 0..18 as a programming error, not a domain error', () => {
    for (const scale of [-1, 19, 1.5]) {
      expect(() => parseScaledDecimal('1', { ...amountOptions, scale })).toThrowError(RangeError);
    }
  });

  it('accepts any scale in range, padding the fraction exactly', () => {
    expect(parseScaledDecimal('1', { ...amountOptions, scale: 0 })).toBe(1n);
    expect(parseScaledDecimal('1.5', { ...amountOptions, scale: 1 })).toBe(15n);
    expect(parseScaledDecimal('1.5', { ...amountOptions, scale: 18 })).toBe(1500000000000000000n);
  });
});

describe('DECIMAL_PATTERN', () => {
  it('describes the accepted grammar: optional sign, digits, optional fraction', () => {
    expect(DECIMAL_PATTERN.test('12')).toBe(true);
    expect(DECIMAL_PATTERN.test('-12.34')).toBe(true);
    expect(DECIMAL_PATTERN.test('0.5')).toBe(true);
    expect(DECIMAL_PATTERN.test('.5')).toBe(false);
    expect(DECIMAL_PATTERN.test('1.')).toBe(false);
    expect(DECIMAL_PATTERN.test('1 000')).toBe(false);
    expect(DECIMAL_PATTERN.test('')).toBe(false);
  });
});

describe('divRoundHalfUp', () => {
  it('rounds half away from zero, so a credit note negates its invoice exactly', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divRoundHalfUp(3n, 2n)).toBe(2n);
    expect(divRoundHalfUp(-3n, 2n)).toBe(-2n);
    expect(divRoundHalfUp(4n, 2n)).toBe(2n);
    expect(divRoundHalfUp(-4n, 2n)).toBe(-2n);
    expect(divRoundHalfUp(0n, 7n)).toBe(0n);
  });

  it('handles a negative denominator by sign, not by accident', () => {
    expect(divRoundHalfUp(7n, -2n)).toBe(-4n);
    expect(divRoundHalfUp(-7n, -2n)).toBe(4n);
  });

  it('names division by zero rather than returning NaN or Infinity', () => {
    expectDomainError(() => divRoundHalfUp(1n, 0n), DomainErrorCode.DIVISION_BY_ZERO);
  });

  it('never moves a value by more than half a unit, for any pair of integers', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc.bigInt({ min: 1n, max: 10n ** 6n }),
        (numerator, denominator) => {
          const rounded = divRoundHalfUp(numerator, denominator);
          const signedError = rounded * denominator - numerator;
          const error = signedError < 0n ? -signedError : signedError;

          expect(2n * error).toBeLessThanOrEqual(denominator);
        },
      ),
    );
  });
});

describe('multiplyScaled', () => {
  it('multiplies two scaled integers and rounds back to the same scale', () => {
    expect(multiplyScaled(25000n, 40000n, 4)).toBe(100000n);
    expect(multiplyScaled(1n, 1n, 0)).toBe(1n);
    expect(multiplyScaled(5n, 5n, 1)).toBe(3n);
  });

  it('validates its scale like every other scaled operation', () => {
    expect(() => multiplyScaled(1n, 1n, 25)).toThrowError(RangeError);
  });
});

describe('formatScaledDecimal', () => {
  it('renders an exact plain decimal string with the requested number of places', () => {
    expect(formatScaledDecimal(1234n, 2)).toBe('12.34');
    expect(formatScaledDecimal(-1234n, 2)).toBe('-12.34');
    expect(formatScaledDecimal(0n, 2)).toBe('0.00');
    expect(formatScaledDecimal(5n, 4)).toBe('0.0005');
    expect(formatScaledDecimal(1n, 18)).toBe('0.000000000000000001');
  });

  it('omits the decimal point entirely when the scale is 0', () => {
    expect(formatScaledDecimal(1234n, 0)).toBe('1234');
    expect(formatScaledDecimal(-1n, 0)).toBe('-1');
  });

  it('is the inverse of parsing for every value it can render', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.integer({ min: 0, max: 8 }),
        (value, scale) => {
          const text = formatScaledDecimal(value, scale);
          const reparsed = parseScaledDecimal(text, {
            scale,
            code: DomainErrorCode.INVALID_AMOUNT,
            label: 'amount',
            allowNegative: true,
          });

          expect(reparsed).toBe(value);
        },
      ),
    );
  });

  it('fails loudly on a scale it cannot render', () => {
    expect(() => formatScaledDecimal(1n, -1)).toThrowError(RangeError);
    expect(() => formatScaledDecimal(1n, 19)).toThrowError(RangeError);
  });
});
