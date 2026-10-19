import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CURRENCY_CODES,
  CurrencyCode,
  DomainErrorCode,
  formatMoney,
  minorUnitExponent,
  parseScaledDecimal,
  toPlainDecimal,
  type MinorUnits,
} from '../index';

/** The inverse of `formatMoney`, so the round-trip property below can be read as one line. */
function parseAmount(plain: string, currency: CurrencyCode): MinorUnits {
  return parseScaledDecimal(plain, {
    scale: minorUnitExponent(currency),
    code: DomainErrorCode.INVALID_AMOUNT,
    label: 'amount',
    allowNegative: true,
  });
}

describe('formatMoney', () => {
  it('renders the Kosovo convention with the ISO code by default', () => {
    expect(formatMoney(123456n, CurrencyCode.EUR)).toBe('1.234,56 EUR');
    expect(formatMoney(1234n, CurrencyCode.EUR)).toBe('12,34 EUR');
    expect(formatMoney(0n, CurrencyCode.EUR)).toBe('0,00 EUR');
    expect(formatMoney(5n, CurrencyCode.EUR)).toBe('0,05 EUR');
    expect(formatMoney(-50n, CurrencyCode.EUR)).toBe('-0,50 EUR');
    expect(formatMoney(-123456n, CurrencyCode.EUR)).toBe('-1.234,56 EUR');
  });

  it('honours a currency with no minor unit at all', () => {
    expect(minorUnitExponent(CurrencyCode.JPY)).toBe(0);
    expect(formatMoney(1234n, CurrencyCode.JPY)).toBe('1.234 JPY');
    expect(formatMoney(0n, CurrencyCode.JPY)).toBe('0 JPY');
    expect(formatMoney(-1234n, CurrencyCode.JPY)).toBe('-1.234 JPY');
    expect(formatMoney(1234n, CurrencyCode.JPY, { decimalSeparator: '.' })).toBe('1.234 JPY');
  });

  it('honours a currency with three decimal places', () => {
    expect(minorUnitExponent(CurrencyCode.KWD)).toBe(3);
    expect(formatMoney(1234n, CurrencyCode.KWD)).toBe('1,234 KWD');
    expect(formatMoney(1n, CurrencyCode.KWD)).toBe('0,001 KWD');
    expect(formatMoney(1000n, CurrencyCode.KWD)).toBe('1,000 KWD');
    expect(formatMoney(1234567n, CurrencyCode.KWD)).toBe('1.234,567 KWD');
  });

  it('renders exactly the unit it is given, and nothing when it is given an empty one', () => {
    expect(formatMoney(123456n, CurrencyCode.EUR, { unit: '€' })).toBe('1.234,56 €');
    expect(formatMoney(123456n, CurrencyCode.EUR, { unit: '' })).toBe('1.234,56');
    expect(formatMoney(1234n, CurrencyCode.JPY, { unit: '' })).toBe('1.234');
  });

  it('renders another locale when it is told the separators', () => {
    expect(
      formatMoney(123456n, CurrencyCode.EUR, { decimalSeparator: '.', groupSeparator: ',' }),
    ).toBe('1,234.56 EUR');
    expect(
      formatMoney(-50n, CurrencyCode.EUR, {
        decimalSeparator: '.',
        groupSeparator: ',',
        unit: '',
      }),
    ).toBe('-0.50');
  });

  it('groups long amounts digit for digit, where a double would already be wrong', () => {
    expect(formatMoney(12345678901234567890123n, CurrencyCode.EUR)).toBe(
      '123.456.789.012.345.678.901,23 EUR',
    );
    expect(formatMoney(999999999n, CurrencyCode.EUR)).toBe('9.999.999,99 EUR');
  });

  it('round-trips through the display form and back, for every currency', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 24n), max: 10n ** 24n }),
        fc.constantFrom(...CURRENCY_CODES),
        (amount, currency) => {
          const displayed = formatMoney(amount, currency, { unit: '' });

          expect(parseAmount(toPlainDecimal(displayed), currency)).toBe(amount);
          expect(formatMoney(amount, currency).endsWith(` ${currency}`)).toBe(true);
        },
      ),
    );
  });

  it('always writes the currency exponent it was asked for, never a rounded one', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n }),
        fc.constantFrom(...CURRENCY_CODES),
        (amount, currency) => {
          const displayed = formatMoney(amount, currency, { unit: '' });
          const fractionLength = displayed.split(',')[1]?.length ?? 0;

          expect(fractionLength).toBe(minorUnitExponent(currency));
        },
      ),
    );
  });
});
