import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  DomainErrorCode,
  TAX_CATEGORIES,
  TaxCategory,
  applyRate,
  isTaxCategory,
  isTaxRate,
  taxCategoryIsTaxable,
  taxForBase,
  taxRateScaled,
  type TaxRate,
} from './index';
import { expectDomainError } from './testing/domain-error';

const vat18: TaxRate = {
  id: 'vat-18',
  name: 'VAT 18%',
  category: TaxCategory.STANDARD,
  ratePercent: '18',
  countryCode: 'XK',
};

const vat8: TaxRate = {
  id: 'vat-8',
  name: 'VAT 8.5%',
  category: TaxCategory.REDUCED,
  ratePercent: '8.5',
};

const zeroRated: TaxRate = {
  id: 'vat-0',
  name: 'Zero rated',
  category: TaxCategory.ZERO,
  ratePercent: '0',
};

const exemptExport: TaxRate = {
  id: 'export',
  name: 'Export outside Kosovo',
  category: TaxCategory.EXEMPT,
  ratePercent: '0',
};

const reverseCharge: TaxRate = {
  id: 'reverse-charge',
  name: 'Reverse charge (services)',
  category: TaxCategory.REVERSE_CHARGE,
  ratePercent: '0',
};

describe('tax categories', () => {
  it('are a closed set of five distinct values', () => {
    expect(TAX_CATEGORIES).toHaveLength(5);
    expect(new Set(TAX_CATEGORIES).size).toBe(TAX_CATEGORIES.length);
    expect(TAX_CATEGORIES).toContain(TaxCategory.REVERSE_CHARGE);
  });

  it('are recognised only as known strings', () => {
    expect(isTaxCategory('STANDARD')).toBe(true);
    expect(isTaxCategory('standard')).toBe(false);
    expect(isTaxCategory('VAT')).toBe(false);
    expect(isTaxCategory(18)).toBe(false);
    expect(isTaxCategory(null)).toBe(false);
  });

  it('decide whether a rate is charged at all', () => {
    expect(taxCategoryIsTaxable(TaxCategory.STANDARD)).toBe(true);
    expect(taxCategoryIsTaxable(TaxCategory.REDUCED)).toBe(true);
    expect(taxCategoryIsTaxable(TaxCategory.ZERO)).toBe(false);
    expect(taxCategoryIsTaxable(TaxCategory.EXEMPT)).toBe(false);
    expect(taxCategoryIsTaxable(TaxCategory.REVERSE_CHARGE)).toBe(false);
  });
});

describe('isTaxRate', () => {
  it('accepts a rate as data, with or without a country', () => {
    expect(isTaxRate(vat18)).toBe(true);
    expect(isTaxRate(vat8)).toBe(true);
    expect(isTaxRate({ ...vat8, countryCode: 'XK' })).toBe(true);
  });

  it('rejects anything that could not produce a correct invoice line', () => {
    const rejected: unknown[] = [
      null,
      'vat-18',
      18,
      {},
      { ...vat18, id: 18 },
      { ...vat18, name: undefined },
      { ...vat18, category: 'VAT' },
      { ...vat18, ratePercent: 18 },
      { ...vat18, countryCode: 3 },
    ];

    for (const candidate of rejected) {
      expect(isTaxRate(candidate)).toBe(false);
    }
  });
});

describe('taxRateScaled', () => {
  it('scales a percentage string to 4 dp', () => {
    expect(taxRateScaled(vat18)).toBe(180000n);
    expect(taxRateScaled(vat8)).toBe(85000n);
  });

  it('pins the non-taxable categories to exactly zero', () => {
    for (const rate of [zeroRated, exemptExport, reverseCharge]) {
      expect(taxRateScaled(rate)).toBe(0n);
    }
  });

  it('refuses a reverse-charge row that carries a percentage', () => {
    expectDomainError(
      () => taxRateScaled({ ...reverseCharge, ratePercent: '18' }),
      DomainErrorCode.INVALID_RATE,
    );
    expectDomainError(
      () => taxRateScaled({ ...exemptExport, ratePercent: '0.0001' }),
      DomainErrorCode.INVALID_RATE,
    );
  });

  it('refuses a category outside the closed set, even when it type-asserts its way in', () => {
    const smuggled = { ...vat18, category: 'VAT' as TaxCategory };
    const error = expectDomainError(() => taxRateScaled(smuggled), DomainErrorCode.INVALID_RATE);

    expect(error.details).toEqual({ taxRateId: 'vat-18', category: 'VAT' });
  });

  it('delegates the percentage rules to the shared parser', () => {
    expectDomainError(
      () => taxRateScaled({ ...vat18, ratePercent: '-18' }),
      DomainErrorCode.INVALID_RATE,
    );
    expectDomainError(
      () => taxRateScaled({ ...vat18, ratePercent: '118' }),
      DomainErrorCode.INVALID_RATE,
    );
    expectDomainError(
      () => taxRateScaled({ ...vat18, ratePercent: 'eighteen' }),
      DomainErrorCode.INVALID_RATE,
    );
  });
});

describe('taxForBase', () => {
  it('charges the percentage for taxable categories', () => {
    expect(taxForBase(10000n, vat18)).toBe(1800n);
    expect(taxForBase(10000n, vat8)).toBe(850n);
    expect(taxForBase(3085n, vat18)).toBe(555n);
    expect(taxForBase(0n, vat18)).toBe(0n);
  });

  it('charges nothing for the categories that mean "no tax", whatever the base', () => {
    for (const rate of [zeroRated, exemptExport, reverseCharge]) {
      expect(taxForBase(10n ** 12n, rate)).toBe(0n);
      expect(taxForBase(0n, rate)).toBe(0n);
    }
  });

  it('agrees with the shared rounding rule, so tax can never be "a bit more"', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.bigInt({ min: 0n, max: 1000000n }),
        (baseMinor, rateScaled) => {
          const rate: TaxRate = { ...vat18, ratePercent: percentFromScaled(rateScaled) };

          expect(taxForBase(baseMinor, rate)).toBe(applyRate(baseMinor, rateScaled));
        },
      ),
    );
  });

  it('never exceeds the base for a rate within 0..100 %', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.integer({ min: 0, max: 10000 }),
        (baseMinor, rateInBasisPoints) => {
          const rate: TaxRate = {
            ...vat18,
            ratePercent: `${String(Math.trunc(rateInBasisPoints / 100))}.${String(
              rateInBasisPoints % 100,
            ).padStart(2, '0')}`,
          };
          const taxMinor = taxForBase(baseMinor, rate);

          expect(taxMinor).toBeGreaterThanOrEqual(0n);
          expect(taxMinor).toBeLessThanOrEqual(baseMinor);
        },
      ),
    );
  });

  it('grows with the base: doubling the base cannot shrink or double-plus-one the tax', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.integer({ min: 0, max: 100 }),
        (baseMinor, percentWhole) => {
          const rate: TaxRate = { ...vat18, ratePercent: String(percentWhole) };
          const single = taxForBase(baseMinor, rate);
          const doubled = taxForBase(baseMinor * 2n, rate);
          const difference = doubled - single * 2n;

          expect(doubled).toBeGreaterThanOrEqual(single);
          expect(difference >= -1n && difference <= 1n).toBe(true);
        },
      ),
    );
  });
});

/** Turns a 4 dp scaled percentage back into the decimal string a rate row would carry. */
function percentFromScaled(rateScaled: bigint): string {
  const whole = rateScaled / 10000n;
  const fraction = rateScaled % 10000n;
  const fractionDigits = fraction.toString().padStart(4, '0').replace(/0+$/, '');

  return fractionDigits === '' ? whole.toString() : `${whole.toString()}.${fractionDigits}`;
}
