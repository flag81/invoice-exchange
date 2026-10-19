import { describe, expect, it } from 'vitest';

import { DomainError, DomainErrorCode } from '../errors';
import { TaxCategory } from '../tax';
import {
  attempt,
  errorProblem,
  normaliseDecimalText,
  parseMoneyText,
  parseQuantityText,
  parseRateText,
  parseTaxCategoryWord,
  problem,
  quantityToText,
  stripAmountNoise,
  warningProblem,
} from './values';

describe('normaliseDecimalText', () => {
  it('leaves a machine number alone', () => {
    expect(normaliseDecimalText('1234.56')).toBe('1234.56');
    expect(normaliseDecimalText('1234')).toBe('1234');
    expect(normaliseDecimalText('-0.05')).toBe('-0.05');
  });

  it('reads either separator order when both are present, because only one can be the decimal one', () => {
    expect(normaliseDecimalText('1.234,56')).toBe('1234.56');
    expect(normaliseDecimalText('1,234.56')).toBe('1234.56');
    expect(normaliseDecimalText('1.234.567,89')).toBe('1234567.89');
  });

  it('reads a single comma as the decimal separator, the way the market writes it', () => {
    expect(normaliseDecimalText('12,50')).toBe('12.50');
    expect(normaliseDecimalText('2,5')).toBe('2.5');
  });

  it('reads repeated separators of one kind as grouping', () => {
    expect(normaliseDecimalText('1,234,567')).toBe('1234567');
    expect(normaliseDecimalText('1.234.567')).toBe('1234567');
  });

  it('strips what only the page cared about: currency, unit and percent signs', () => {
    expect(normaliseDecimalText('€ 1.234,56')).toBe('1234.56');
    expect(normaliseDecimalText('12,50 EUR')).toBe('12.50');
    expect(normaliseDecimalText('2,5 kg')).toBe('2.5');
    expect(normaliseDecimalText('18 %')).toBe('18');
  });

  it('returns null when there is no number in the text at all', () => {
    expect(normaliseDecimalText('')).toBeNull();
    expect(normaliseDecimalText('EUR')).toBeNull();
    expect(normaliseDecimalText('-')).toBeNull();
  });
});

describe('stripAmountNoise', () => {
  it('keeps digits, separators and the sign and nothing else', () => {
    expect(stripAmountNoise('Total: -1.234,56 EUR')).toBe('-1.234,56');
  });
});

describe('parseMoneyText', () => {
  it('parses amounts in the formats a receipt and a keyboard produce', () => {
    expect(parseMoneyText('12,50', 'EUR')).toBe(1250n);
    expect(parseMoneyText('1.234,56', 'EUR')).toBe(123456n);
    expect(parseMoneyText('1,234.56', 'EUR')).toBe(123456n);
    expect(parseMoneyText('€ 12,50 EUR', 'EUR')).toBe(1250n);
    expect(parseMoneyText('0', 'EUR')).toBe(0n);
    expect(parseMoneyText('-5,00', 'EUR')).toBe(-500n);
  });

  it('lets the currency decide how many places are legal', () => {
    expect(parseMoneyText('12.345', 'EUR')).toBeNull();
    expect(parseMoneyText('1234', 'JPY')).toBe(1234n);
    expect(parseMoneyText('1234.567', 'KWD')).toBe(1234567n);
  });

  it('returns null rather than a wrong number when the text is not an amount', () => {
    expect(parseMoneyText(null, 'EUR')).toBeNull();
    expect(parseMoneyText('', 'EUR')).toBeNull();
    expect(parseMoneyText('abc', 'EUR')).toBeNull();
    expect(parseMoneyText('€', 'EUR')).toBeNull();
    expect(parseMoneyText('--', 'EUR')).toBeNull();
  });

  it('reads repeated separators of one kind as grouping, however odd the grouping looks', () => {
    expect(parseMoneyText('12,3,4', 'EUR')).toBe(123_400n);
  });
});

describe('parseQuantityText', () => {
  it('parses quantities at the 4 dp scale the domain stores', () => {
    expect(parseQuantityText('2,5')).toBe(25_000n);
    expect(parseQuantityText('2.5')).toBe(25_000n);
    expect(parseQuantityText('1')).toBe(10_000n);
    expect(parseQuantityText('0,125')).toBe(1250n);
  });

  it('refuses a negative quantity, because a credit note is a separate document', () => {
    expect(parseQuantityText('-1')).toBeNull();
  });

  it('returns null for text that is not a quantity', () => {
    expect(parseQuantityText(null)).toBeNull();
    expect(parseQuantityText('many')).toBeNull();
  });
});

describe('parseRateText', () => {
  it('parses percentages, including the sign a page prints', () => {
    expect(parseRateText('18')).toBe(180_000n);
    expect(parseRateText('18 %')).toBe(180_000n);
    expect(parseRateText('8,5')).toBe(85_000n);
    expect(parseRateText('0')).toBe(0n);
  });

  it('refuses a rate above 100 and text that is not a rate', () => {
    expect(parseRateText('101')).toBeNull();
    expect(parseRateText('vat')).toBeNull();
    expect(parseRateText(null)).toBeNull();
  });
});

describe('quantityToText', () => {
  it('renders the stored scale without the trailing zeros nobody typed', () => {
    expect(quantityToText(25_000n)).toBe('2.5');
    expect(quantityToText(10_000n)).toBe('1');
    expect(quantityToText(0n)).toBe('0');
    expect(quantityToText(1250n)).toBe('0.125');
    expect(quantityToText(1n)).toBe('0.0001');
  });
});

describe('parseTaxCategoryWord', () => {
  it('reads the canonical names, however they were capitalised or spaced', () => {
    expect(parseTaxCategoryWord('standard')).toBe(TaxCategory.STANDARD);
    expect(parseTaxCategoryWord('Reverse Charge')).toBe(TaxCategory.REVERSE_CHARGE);
    expect(parseTaxCategoryWord('reverse-charge')).toBe(TaxCategory.REVERSE_CHARGE);
    expect(parseTaxCategoryWord('EXEMPT')).toBe(TaxCategory.EXEMPT);
  });

  it('reads the abbreviations receipts print in this region and abroad', () => {
    expect(parseTaxCategoryWord('VAT')).toBe(TaxCategory.STANDARD);
    expect(parseTaxCategoryWord('PDV')).toBe(TaxCategory.STANDARD);
    expect(parseTaxCategoryWord('MwSt')).toBe(TaxCategory.STANDARD);
    expect(parseTaxCategoryWord('no vat')).toBe(TaxCategory.ZERO);
    expect(parseTaxCategoryWord('0')).toBe(TaxCategory.ZERO);
    expect(parseTaxCategoryWord('RC')).toBe(TaxCategory.REVERSE_CHARGE);
  });

  it('returns null for words it does not know instead of picking a rate', () => {
    expect(parseTaxCategoryWord('wholesale')).toBeNull();
    expect(parseTaxCategoryWord(null)).toBeNull();
  });
});

describe('problem constructors', () => {
  it('builds the three shapes the review screen renders', () => {
    expect(problem('INVALID_UNIT_PRICE', 'warning', 'careful')).toEqual({
      code: 'INVALID_UNIT_PRICE',
      severity: 'warning',
      message: 'careful',
    });
    expect(errorProblem('NO_LINES', 'nothing here', { field: 'lines', lineIndex: 3 })).toEqual({
      code: 'NO_LINES',
      severity: 'error',
      message: 'nothing here',
      field: 'lines',
      lineIndex: 3,
    });
    expect(warningProblem('CURRENCY_NOT_FOUND', 'assumed EUR')).toMatchObject({
      severity: 'warning',
    });
  });
});

describe('attempt', () => {
  it('turns a domain failure into null, so one bad field does not fail a request', () => {
    const failure = attempt(() => {
      throw new DomainError(DomainErrorCode.INVALID_AMOUNT, 'nope');
    });

    expect(failure).toBeNull();
  });

  it('rethrows anything that is not a domain failure, because that is a bug', () => {
    expect(() =>
      attempt(() => {
        throw new TypeError('a real bug');
      }),
    ).toThrow(TypeError);
  });

  it('returns the value when the parser is happy', () => {
    expect(attempt(() => 42)).toBe(42);
  });
});
