import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DECIMAL_SEPARATOR,
  DEFAULT_GROUP_SEPARATOR,
  groupThousands,
  splitDecimal,
  toPlainDecimal,
  trimTrailingZeros,
} from '../index';

describe('splitDecimal', () => {
  it('cuts a plain decimal into integer and exactly `scale` fraction digits', () => {
    expect(splitDecimal('12345.56', 2)).toEqual(['12345', '56']);
    expect(splitDecimal('12345.5', 2)).toEqual(['12345', '50']);
    expect(splitDecimal('5', 2)).toEqual(['5', '00']);
    expect(splitDecimal('0.5', 2)).toEqual(['0', '50']);
    expect(splitDecimal('-12.34', 2)).toEqual(['12', '34']);
    expect(splitDecimal('1.234', 2)).toEqual(['1', '23']);
    expect(splitDecimal('.5', 2)).toEqual(['0', '50']);
  });

  it('does not invent a decimal point at scale 0', () => {
    expect(splitDecimal('1234', 0)).toEqual(['1234', '']);
    expect(splitDecimal('1234.9', 0)).toEqual(['1234', '']);
  });
});

describe('groupThousands', () => {
  it('inserts a separator every three digits, counting from the right', () => {
    expect(groupThousands('1234567', '.')).toBe('1.234.567');
    expect(groupThousands('12345', '.')).toBe('12.345');
    expect(groupThousands('1234', '.')).toBe('1.234');
    expect(groupThousands('123', '.')).toBe('123');
    expect(groupThousands('1', '.')).toBe('1');
    expect(groupThousands('', '.')).toBe('');
  });

  it('takes the separator it is given, so a locale can be rendered without ICU', () => {
    expect(groupThousands('1234567', ',')).toBe('1,234,567');
    expect(groupThousands('1234567', ' ')).toBe('1 234 567');
    expect(groupThousands('123456', '')).toBe('123456');
  });

  it('is exact for long numbers, where a float would have lost the last digit', () => {
    expect(groupThousands('123456789012345678901234567890', '.')).toBe(
      '123.456.789.012.345.678.901.234.567.890',
    );
  });
});

describe('trimTrailingZeros', () => {
  it('drops the zeros a user never typed, and nothing else', () => {
    expect(trimTrailingZeros('5000')).toBe('5');
    expect(trimTrailingZeros('0000')).toBe('');
    expect(trimTrailingZeros('1234')).toBe('1234');
    expect(trimTrailingZeros('')).toBe('');
    expect(trimTrailingZeros('1001')).toBe('1001');
    expect(trimTrailingZeros('5100')).toBe('51');
  });
});

describe('toPlainDecimal', () => {
  it('defaults to the Kosovo convention and hands the parsers a plain string', () => {
    expect(DEFAULT_DECIMAL_SEPARATOR).toBe(',');
    expect(DEFAULT_GROUP_SEPARATOR).toBe('.');

    expect(toPlainDecimal('1.234,56')).toBe('1234.56');
    expect(toPlainDecimal('1234,56')).toBe('1234.56');
    expect(toPlainDecimal('1234')).toBe('1234');
    expect(toPlainDecimal('-0,05')).toBe('-0.05');
    expect(toPlainDecimal('1.234,56 EUR')).toBe('1234.56EUR');
  });

  it('removes the spaces a password manager, a page or a spreadsheet inserts', () => {
    expect(toPlainDecimal('1 234,56')).toBe('1234.56');
    expect(toPlainDecimal('1\u00a0234,56')).toBe('1234.56');
    expect(toPlainDecimal('1\u202f234,56')).toBe('1234.56');
    expect(toPlainDecimal('\t1.234,56\n')).toBe('1234.56');
  });

  it('renders another locale when it is told the separators', () => {
    const us = { decimalSeparator: '.', groupSeparator: ',' };

    expect(toPlainDecimal('1,234.56', us)).toBe('1234.56');
    expect(toPlainDecimal('1.5', us)).toBe('1.5');
    expect(toPlainDecimal('1,5')).toBe('1.5');
  });

  it('treats a separator the input cannot contain as a programming error, not a domain error', () => {
    expect(() => toPlainDecimal('1,5', { decimalSeparator: ',', groupSeparator: ',' })).toThrow(
      RangeError,
    );
  });

  it('is what makes a displayed amount readable again, digits unchanged', () => {
    const digits = fc.integer({ min: 0, max: 1_000_000_000 }).map((value) => String(value));
    const fraction = fc
      .integer({ min: 0, max: 9999 })
      .map((value) => String(value).padStart(4, '0'));

    fc.assert(
      fc.property(digits, fraction, (integerPart, fractionPart) => {
        const displayed = `${groupThousands(integerPart, DEFAULT_GROUP_SEPARATOR)}${DEFAULT_DECIMAL_SEPARATOR}${fractionPart}`;
        const quoted = `${groupThousands(integerPart, '\u00a0')}${DEFAULT_DECIMAL_SEPARATOR}${fractionPart}`;

        expect(toPlainDecimal(displayed)).toBe(`${integerPart}.${fractionPart}`);
        expect(toPlainDecimal(quoted)).toBe(`${integerPart}.${fractionPart}`);
      }),
    );
  });
});

describe('the helpers stay free of floating point', () => {
  it('never parses what it renders: a 30-digit amount survives split, group and trim', () => {
    const digits = '9'.repeat(30);
    const [integerPart, fractionPart] = splitDecimal(`${digits}.09`, 2);

    expect(integerPart).toBe(digits);
    expect(fractionPart).toBe('09');
    expect(groupThousands(integerPart, '.')).toBe('999.999.999.999.999.999.999.999.999.999');
    expect(trimTrailingZeros('9900')).toBe('99');
  });
});
