/**
 * What a brand-new tenant starts with.
 *
 * Two callers depend on this table — the seed and the sign-in path — so the tests pin the *shape* a
 * company needs to be usable at all: exactly one default rate, unique codes, and a name that never
 * comes out empty (a company with a blank name cannot be told apart in the UI).
 */

import { describe, expect, it } from 'vitest';

import {
  KOSOVO_VAT_RATES,
  PROVISIONED_COUNTRY_CODE,
  PROVISIONED_CURRENCY,
  provisionedCompanyName,
} from './provisioning';

describe('KOSOVO_VAT_RATES', () => {
  it('covers the five Kosovo cases: standard, reduced, zero, exempt and reverse charge', () => {
    expect(KOSOVO_VAT_RATES.map((rate) => rate.category)).toEqual([
      'STANDARD',
      'REDUCED',
      'ZERO',
      'EXEMPT',
      'REVERSE_CHARGE',
    ]);
  });

  it('marks exactly one rate as the default, so a new line has an unambiguous rate', () => {
    const defaults = KOSOVO_VAT_RATES.filter((rate) => rate.isDefault);

    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.code).toBe('vat-18');
    expect(defaults[0]?.ratePercent).toBe('18');
  });

  it('has unique codes, because the code is what a line stores', () => {
    const codes = KOSOVO_VAT_RATES.map((rate) => rate.code);

    expect(new Set(codes).size).toBe(codes.length);
  });

  it('provisions Kosovo trading in euro until the settings screen says otherwise', () => {
    expect(PROVISIONED_COUNTRY_CODE).toBe('XK');
    expect(PROVISIONED_CURRENCY).toBe('EUR');
  });
});

describe('provisionedCompanyName', () => {
  it("uses the person's name as the placeholder company name", () => {
    expect(provisionedCompanyName('Arta Berisha', 'arta@example.test')).toBe('Arta Berisha');
  });

  it('trims it, so a stray space does not become part of the name', () => {
    expect(provisionedCompanyName('  Arta Berisha  ', 'arta@example.test')).toBe('Arta Berisha');
  });

  it('falls back to the local part of the email when no name was given', () => {
    expect(provisionedCompanyName(null, 'arta@example.test')).toBe('arta');
    expect(provisionedCompanyName('   ', 'arta@example.test')).toBe('arta');
  });

  it('returns the whole email rather than an empty name when there is no local part', () => {
    expect(provisionedCompanyName(null, '@example.test')).toBe('@example.test');
  });
});
