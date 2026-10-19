/**
 * Currencies and their minor-unit exponents (ISO 4217).
 *
 * The set is closed on purpose. Money in this domain is an integer count of *minor* units, so the
 * exponent is not a display detail — it is what turns `1234n` into `12.34` or `1234`. An open string
 * type would push that decision to the edge and invite a silent factor-of-100 error; a currency the
 * build does not know about is rejected instead.
 *
 * Adding a currency is a one-line change here (`docs/architecture.md` §4.4 keeps tax *rates* as data
 * with Kosovo defaults in the seed, but the currency scale has to be code, because arithmetic
 * depends on it).
 */
export const CurrencyCode = {
  EUR: 'EUR',
  USD: 'USD',
  GBP: 'GBP',
  CHF: 'CHF',
  /** Albanian lek — same 2 dp scale as EUR. */
  ALL: 'ALL',
  RSD: 'RSD',
  MKD: 'MKD',
  /** 0 dp: there is no minor unit to store. */
  JPY: 'JPY',
  /** 3 dp (1/1000). */
  KWD: 'KWD',
  BHD: 'BHD',
} as const;

export type CurrencyCode = (typeof CurrencyCode)[keyof typeof CurrencyCode];

/** Exponents are explicit per currency rather than assumed to be 2. */
const MINOR_UNIT_EXPONENTS: Readonly<Record<CurrencyCode, number>> = {
  EUR: 2,
  USD: 2,
  GBP: 2,
  CHF: 2,
  ALL: 2,
  RSD: 2,
  MKD: 2,
  JPY: 0,
  KWD: 3,
  BHD: 3,
};

export const CURRENCY_CODES: readonly CurrencyCode[] = Object.values(CurrencyCode);

/** Guard for untrusted input at the edges (env vars, request bodies, CSV imports). */
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (CURRENCY_CODES as readonly string[]).includes(value);
}

/** Number of decimal places the currency is stored with: 2 for EUR, 0 for JPY, 3 for KWD. */
export function minorUnitExponent(currency: CurrencyCode): number {
  return MINOR_UNIT_EXPONENTS[currency];
}

/** `10 ** exponent` as a `bigint`, the divisor that moves between minor and major units. */
export function minorUnitScale(currency: CurrencyCode): bigint {
  return 10n ** BigInt(minorUnitExponent(currency));
}
