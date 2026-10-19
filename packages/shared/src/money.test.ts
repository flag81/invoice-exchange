import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CURRENCY_CODES,
  CurrencyCode,
  DomainErrorCode,
  ZERO_MINOR,
  absolute,
  add,
  applyRate,
  assertNonNegative,
  compare,
  isMinorUnits,
  isNegative,
  isZero,
  multiplyByQuantity,
  negate,
  parseAmount,
  subtract,
  sum,
  toDecimalString,
} from './index';
import { captureDomainError, expectDomainError } from './testing/domain-error';

const EUR = CurrencyCode.EUR;

describe('isMinorUnits', () => {
  it('accepts a bigint and nothing that merely looks like an amount', () => {
    expect(isMinorUnits(0n)).toBe(true);
    expect(isMinorUnits(1234)).toBe(false);
    expect(isMinorUnits('1234')).toBe(false);
    expect(isMinorUnits(undefined)).toBe(false);
  });
});

describe('parseAmount', () => {
  it('reads a major-unit string using the currency, not a decimal point', () => {
    expect(parseAmount('12.34', EUR)).toBe(1234n);
    expect(parseAmount('-0.50', EUR)).toBe(-50n);
    expect(parseAmount('0', EUR)).toBe(0n);
    expect(parseAmount('1234', CurrencyCode.JPY)).toBe(1234n);
    expect(parseAmount('1.234', CurrencyCode.KWD)).toBe(1234n);
  });

  it('is exact where floating point is not', () => {
    expect(parseAmount('0.1', EUR) + parseAmount('0.2', EUR)).toBe(parseAmount('0.3', EUR));
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('refuses to silently drop a digit', () => {
    expectDomainError(() => parseAmount('1.234', EUR), DomainErrorCode.INVALID_AMOUNT);
    expectDomainError(() => parseAmount('1.2', CurrencyCode.JPY), DomainErrorCode.INVALID_AMOUNT);
    expectDomainError(() => parseAmount('twelve', EUR), DomainErrorCode.INVALID_AMOUNT);
    expectDomainError(() => parseAmount('', EUR), DomainErrorCode.INVALID_AMOUNT);
    expectDomainError(() => parseAmount('1.234,56', EUR), DomainErrorCode.INVALID_AMOUNT);
  });
});

describe('toDecimalString', () => {
  it('is the exact inverse, with the currency deciding the number of places', () => {
    expect(toDecimalString(1234n, EUR)).toBe('12.34');
    expect(toDecimalString(-50n, EUR)).toBe('-0.50');
    expect(toDecimalString(ZERO_MINOR, EUR)).toBe('0.00');
    expect(toDecimalString(1234n, CurrencyCode.JPY)).toBe('1234');
    expect(toDecimalString(1234n, CurrencyCode.KWD)).toBe('1.234');
  });

  it('stays exact far past the range a float could hold', () => {
    expect(toDecimalString(12345678901234567890n, EUR)).toBe('123456789012345678.90');
  });

  it('round-trips every amount in every supported currency', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.constantFrom(...CURRENCY_CODES),
        (amount, currency) => {
          expect(parseAmount(toDecimalString(amount, currency), currency)).toBe(amount);
        },
      ),
    );
  });
});

describe('exact arithmetic', () => {
  it('adds, subtracts, negates and takes absolute values without rounding', () => {
    expect(add(1234n, 66n)).toBe(1300n);
    expect(subtract(1234n, 1300n)).toBe(-66n);
    expect(negate(1234n)).toBe(-1234n);
    expect(absolute(-1234n)).toBe(1234n);
    expect(absolute(1234n)).toBe(1234n);
  });

  it('sums any number of amounts, including none', () => {
    expect(sum([])).toBe(ZERO_MINOR);
    expect(sum([1234n])).toBe(1234n);
    expect(sum([500n, -200n, 0n])).toBe(300n);
  });

  it('compares without ever losing the equal case', () => {
    expect(compare(1n, 2n)).toBe(-1);
    expect(compare(2n, 2n)).toBe(0);
    expect(compare(3n, 2n)).toBe(1);
  });

  it('answers the zero and negative questions a caller would otherwise get wrong', () => {
    expect(isZero(0n)).toBe(true);
    expect(isZero(1n)).toBe(false);
    expect(isNegative(-1n)).toBe(true);
    expect(isNegative(0n)).toBe(false);
  });
});

describe('assertNonNegative', () => {
  it('accepts zero, because a zero discount and a zero payment are normal', () => {
    expect(() => assertNonNegative(0n, 'line discount')).not.toThrow();
    expect(() => assertNonNegative(1234n, 'line discount')).not.toThrow();
  });

  it('names the field that went negative, so the error is actionable', () => {
    const error = expectDomainError(
      () => assertNonNegative(-1n, 'line discount'),
      DomainErrorCode.INVALID_AMOUNT,
    );

    expect(error.message).toContain('line discount');
    expect(error.details).toEqual({ label: 'line discount', amount: -1n });
  });

  it('returns undefined rather than an amount, so it can only be used as a guard', () => {
    expect(captureDomainError(() => assertNonNegative(-1n, 'unit price'))).toBeInstanceOf(Error);
  });
});

describe('multiplyByQuantity', () => {
  it('rounds the quantity to the cent, half away from zero', () => {
    expect(multiplyByQuantity(1234n, 25000n)).toBe(3085n);
    expect(multiplyByQuantity(100000n, 10000n)).toBe(100000n);
    expect(multiplyByQuantity(1n, 5000n)).toBe(1n);
    expect(multiplyByQuantity(1n, 4999n)).toBe(0n);
    expect(multiplyByQuantity(3n, 5000n)).toBe(2n);
    expect(multiplyByQuantity(-1n, 5000n)).toBe(-1n);
    expect(multiplyByQuantity(0n, 25000n)).toBe(ZERO_MINOR);
  });

  it('is exact whenever the quantity is a whole number', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc.integer({ min: 0, max: 1000 }),
        (unitPriceMinor, wholeQuantity) => {
          const scaledQuantity = BigInt(wholeQuantity) * 10000n;

          expect(multiplyByQuantity(unitPriceMinor, scaledQuantity)).toBe(
            unitPriceMinor * BigInt(wholeQuantity),
          );
        },
      ),
    );
  });
});

describe('applyRate', () => {
  it('applies a percentage, not a factor', () => {
    expect(applyRate(10000n, 180000n)).toBe(1800n);
    expect(applyRate(10000n, 80000n)).toBe(800n);
    expect(applyRate(10000n, 0n)).toBe(ZERO_MINOR);
    expect(applyRate(10000n, 1000000n)).toBe(10000n);
  });

  it('rounds half away from zero, so a credit note stays symmetric', () => {
    expect(applyRate(3085n, 180000n)).toBe(555n);
    expect(applyRate(1n, 500000n)).toBe(1n);
    expect(applyRate(1n, 499999n)).toBe(0n);
    expect(applyRate(3n, 500000n)).toBe(2n);
    expect(applyRate(-1n, 500000n)).toBe(-1n);
  });

  it('stays within half a minor unit of the exact product', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.bigInt({ min: 0n, max: 1000000n }),
        (baseMinor, rateScaled) => {
          const taxMinor = applyRate(baseMinor, rateScaled);
          const signedError = taxMinor * 1000000n - baseMinor * rateScaled;
          const error = signedError < 0n ? -signedError : signedError;

          expect(2n * error).toBeLessThanOrEqual(1000000n);
        },
      ),
    );
  });
});
