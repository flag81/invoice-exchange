import { describe, expect, it } from 'vitest';

import {
  CURRENCY_CODES,
  CurrencyCode,
  isCurrencyCode,
  minorUnitExponent,
  minorUnitScale,
} from './index';

describe('currency', () => {
  it('carries a closed set of the currencies this build supports', () => {
    expect(CURRENCY_CODES).toContain(CurrencyCode.EUR);
    expect(CURRENCY_CODES).toContain(CurrencyCode.JPY);
    expect(CURRENCY_CODES).toContain(CurrencyCode.KWD);
    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length);
  });

  it('recognises those codes, and only as strings that match exactly', () => {
    expect(isCurrencyCode('EUR')).toBe(true);
    expect(isCurrencyCode('eur')).toBe(false);
    expect(isCurrencyCode('XBT')).toBe(false);
    expect(isCurrencyCode(978)).toBe(false);
    expect(isCurrencyCode(null)).toBe(false);
    expect(isCurrencyCode({ code: 'EUR' })).toBe(false);
  });

  it('knows the ISO 4217 minor-unit exponent, including the ones that are not 2', () => {
    expect(minorUnitExponent(CurrencyCode.EUR)).toBe(2);
    expect(minorUnitExponent(CurrencyCode.JPY)).toBe(0);
    expect(minorUnitExponent(CurrencyCode.KWD)).toBe(3);
    expect(minorUnitExponent(CurrencyCode.BHD)).toBe(3);
  });

  it('derives the divisor that moves between minor and major units', () => {
    expect(minorUnitScale(CurrencyCode.EUR)).toBe(100n);
    expect(minorUnitScale(CurrencyCode.JPY)).toBe(1n);
    expect(minorUnitScale(CurrencyCode.KWD)).toBe(1000n);
  });

  it('is total: every currency has an exponent that agrees with its scale', () => {
    for (const currency of CURRENCY_CODES) {
      const exponent = minorUnitExponent(currency);
      expect(Number.isInteger(exponent)).toBe(true);
      expect(exponent).toBeGreaterThanOrEqual(0);
      expect(minorUnitScale(currency)).toBe(10n ** BigInt(exponent));
    }
  });
});
