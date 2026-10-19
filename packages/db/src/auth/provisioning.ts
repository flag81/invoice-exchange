/**
 * What a brand-new tenant starts with.
 *
 * It lives here rather than in `prisma/seed.ts` because two callers now need it: the seed (a demo
 * install) and sign-in (a user who has never had a company). Two copies of the Kosovo VAT table would
 * drift the day a rate changes, so there is one.
 */

/** A rate row as it is inserted: the seed and the sign-in path write exactly these fields. */
export type ProvisionedTaxRate = {
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly ratePercent: string;
  readonly isDefault: boolean;
};

/** The Kosovo defaults: 18 % standard, 8 % reduced, and the three "no VAT is charged" cases. */
export const KOSOVO_VAT_RATES: readonly ProvisionedTaxRate[] = [
  {
    code: 'vat-18',
    name: 'TVSH 18%',
    category: 'STANDARD',
    ratePercent: '18',
    isDefault: true,
  },
  {
    code: 'vat-8',
    name: 'TVSH 8%',
    category: 'REDUCED',
    ratePercent: '8',
    isDefault: false,
  },
  {
    code: 'vat-0',
    name: 'Normë zero 0%',
    category: 'ZERO',
    ratePercent: '0',
    isDefault: false,
  },
  {
    code: 'vat-exempt',
    name: 'I përjashtuar nga TVSH-ja',
    category: 'EXEMPT',
    ratePercent: '0',
    isDefault: false,
  },
  {
    code: 'vat-reverse-charge',
    name: 'Kthimi i TVSH-së (reverse charge)',
    category: 'REVERSE_CHARGE',
    ratePercent: '0',
    isDefault: false,
  },
];

/** The country and currency a new tenant is created with, until the settings screen exists. */
export const PROVISIONED_COUNTRY_CODE = 'XK';
export const PROVISIONED_CURRENCY = 'EUR';

/**
 * The company name shown in "Kompania jote" before anyone has filled in a settings form.
 *
 * A person's name is a poor legal name but an honest placeholder: it is what the account holder calls
 * themselves, and the settings slice (with VAT number and legal name) replaces it deliberately rather
 * than guessing a company out of an email domain.
 */
export function provisionedCompanyName(name: string | null, email: string): string {
  const trimmed = name?.trim();

  if (trimmed !== undefined && trimmed !== '') {
    return trimmed;
  }

  const localPart = email.split('@')[0]?.trim();

  return localPart === undefined || localPart === '' ? email : localPart;
}
