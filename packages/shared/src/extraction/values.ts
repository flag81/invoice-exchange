/**
 * Reading values a model — or a human — wrote down.
 *
 * The two normalisers (`normalise.ts` for provider output, `submission.ts` for the reviewed form) face
 * the same problem: the input is text in whatever format the paper or the keyboard used (`1.234,56`,
 * `€ 12,50`, `2,5 kg`, `18 %`), and the domain only accepts one strict grammar. This module is the one
 * place that bridges the two: it strips presentation, reuses `format.toPlainDecimal` for the decimal
 * separator, and then hands the result to the strict parsers in `money.ts` / `scaled.ts` — which stay
 * the only things that decide whether a value is legal.
 *
 * Every parser here fails to `null` rather than throwing, so a value the model hallucinated becomes a
 * reported problem on one line instead of a 500 from the route handler.
 */

import { isDomainError } from '../errors';
import { type CurrencyCode } from '../currency';
import { type MinorUnits, parseAmount } from '../money';
import { QUANTITY_SCALE, parseQuantity, parseRate, formatScaledDecimal } from '../scaled';
import { toPlainDecimal, trimTrailingZeros } from '../format/exact';
import { isTaxCategory, TaxCategory } from '../tax';
import type { DraftProblem, DraftProblemCode, DraftProblemSeverity } from './types';

export function problem(
  code: DraftProblemCode,
  severity: DraftProblemSeverity,
  message: string,
  extra: { readonly field?: string; readonly lineIndex?: number } = {},
): DraftProblem {
  return { code, severity, message, ...extra };
}

export function errorProblem(
  code: DraftProblemCode,
  message: string,
  extra: { readonly field?: string; readonly lineIndex?: number } = {},
): DraftProblem {
  return problem(code, 'error', message, extra);
}

export function warningProblem(
  code: DraftProblemCode,
  message: string,
  extra: { readonly field?: string; readonly lineIndex?: number } = {},
): DraftProblem {
  return problem(code, 'warning', message, extra);
}

/**
 * Runs a strict parser and turns a *domain* failure into `null`. A non-domain exception is rethrown:
 * that would be a bug in this package, and swallowing it here would hide it behind "unreadable value".
 */
export function attempt<T>(parse: () => T): T | null {
  try {
    return parse();
  } catch (error) {
    if (isDomainError(error)) {
      return null;
    }

    throw error;
  }
}

/**
 * Removes the characters that carry no value — currency symbols, ISO codes, unit suffixes (`2,5 kg`),
 * percent signs, spaces of every width — while leaving digits, separators and the sign in place.
 * Deliberately not a number parser: it only de-noises, and the strict parser still has the last word.
 */
export function stripAmountNoise(text: string): string {
  return text.replace(/[^\d.,-]/g, '');
}

/**
 * Rewrites a number a paper (or a keyboard) wrote into the plain `1234.56` the strict parsers accept.
 *
 * The prompt asks the provider for machine numbers (`1234.56`, no grouping), so this is the exception
 * path — but receipts are what they are, and a value read off paper should not fail for being
 * formatted. Three rules, each deterministic:
 *
 * 1. Both separators present (`1.234,56`, `1,234.56`): the **last** one is the decimal separator. This
 *    is true in every locale that uses both, so nothing is guessed here.
 * 2. Only commas: two or more can only be grouping (`1,234,567`); a single comma is the decimal
 *    separator the market writes (`12,50`).
 * 3. Only dots: two or more can only be grouping (`1.234.567`); a single dot is a decimal point.
 *
 * Rule 3 is the interesting one. Kosovo prints `1.234` for one thousand two hundred thirty-four, so a
 * single dot *could* be a swallowed group separator — and it is read as a decimal point anyway,
 * because for EUR that makes `1.234` an amount with three places, which the parser **rejects** and the
 * review screen shows as a problem. A loud error beats a silent thousandfold mistake on a tax
 * document, which is the only trade this file is willing to make.
 */
export function normaliseDecimalText(text: string): string | null {
  const cleaned = stripAmountNoise(text);

  if (cleaned === '' || /^-+$/.test(cleaned)) {
    return null;
  }

  const hasDot = cleaned.includes('.');
  const hasComma = cleaned.includes(',');

  if (hasDot && hasComma) {
    const decimalSeparator = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.') ? ',' : '.';
    const groupSeparator = decimalSeparator === ',' ? '.' : ',';

    return toPlainDecimal(cleaned, { decimalSeparator, groupSeparator });
  }

  if (hasComma) {
    return cleaned.split(',').length > 2 ? cleaned.split(',').join('') : cleaned.replace(/,/g, '.');
  }

  if (hasDot) {
    return cleaned.split('.').length > 2 ? cleaned.split('.').join('') : cleaned;
  }

  return cleaned;
}

function toPlain(text: string | null): string | null {
  return text === null ? null : normaliseDecimalText(text);
}

/**
 * An amount as minor units for a currency, or `null` when it is not a legal amount for that currency
 * (`'12,345'` in EUR, `'abc'`, an empty string). Locale input is accepted: `'1.234,56'` → `123456n`.
 */
export function parseMoneyText(text: string | null, currency: CurrencyCode): MinorUnits | null {
  const plain = toPlain(text);

  return plain === null ? null : attempt(() => parseAmount(plain, currency));
}

/** A quantity as a 4 dp scaled integer: `'2,5'` → `25000n`. Negative quantities are rejected. */
export function parseQuantityText(text: string | null): bigint | null {
  const plain = toPlain(text);

  return plain === null ? null : attempt(() => parseQuantity(plain));
}

/** A percentage as a 4 dp scaled integer: `'18 %'` → `180000n`. */
export function parseRateText(text: string | null): bigint | null {
  const plain = toPlain(text);

  return plain === null ? null : attempt(() => parseRate(plain));
}

/**
 * The canonical 4 dp quantity string, without the trailing zeros a reader does not need: `25000n` →
 * `'2.5'`. The stored column keeps 4 dp; the API shows the short form.
 */
export function quantityToText(quantityScaled: bigint): string {
  const fixed = formatScaledDecimal(quantityScaled, QUANTITY_SCALE);
  const [integerPart = '0', fractionPart = ''] = fixed.split('.');
  const trimmed = trimTrailingZeros(fractionPart);

  return trimmed === '' ? integerPart : `${integerPart}.${trimmed}`;
}

/**
 * Normalises a printed category word or `null` when it is not one this build knows: `'standard'`,
 * `'Reverse Charge'`, and the abbreviations receipts actually print (VAT, PDV, MwSt, IVA).
 *
 * A category is never inferred from a percentage here — that decision belongs to rate matching, which
 * compares against the tenant's own `TaxRate` rows. This function only reads the word that was printed.
 */
export function parseTaxCategoryWord(text: string | null): TaxCategory | null {
  if (text === null) {
    return null;
  }

  const word = text
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

  if (isTaxCategory(word)) {
    return word;
  }

  if (['VAT', 'PDV', 'MWST', 'IVA', 'TAXABLE', 'STANDARD_RATE'].includes(word)) {
    return TaxCategory.STANDARD;
  }

  if (['NO_VAT', 'VAT_FREE', 'TAX_FREE', 'ZERO_RATED', '0'].includes(word)) {
    return TaxCategory.ZERO;
  }

  if (['RC', 'REVERSE', 'REVERSE_CHARGE_VAT', 'REVERSE_CHARGED'].includes(word)) {
    return TaxCategory.REVERSE_CHARGE;
  }

  if (['EXEMPT', 'EXEMPTED', 'OSLOBODEN'].includes(word)) {
    return TaxCategory.EXEMPT;
  }

  return null;
}
