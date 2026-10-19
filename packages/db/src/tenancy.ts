/**
 * The tenant loader — "everything a request needs to know about the company it is acting for".
 *
 * Until phase 3 this module answered "who is asking?" with "the one seeded company"
 * (`resolveMvpTenant`). Now the caller has already answered that question — the session resolved to a
 * user, and the user's active membership to a company — so this module's job is narrower and safer:
 * load that company's currency and VAT table, scoped by the id it was given, and return `null` when the
 * row is gone (a session outliving its company is a sign-out, not a 500).
 *
 * Every query in this package already takes a `companyId`; nothing else had to change.
 */

import {
  DomainError,
  DomainErrorCode,
  isCurrencyCode,
  isTaxCategory,
  type CurrencyCode,
  type TaxRate,
} from '@einv/shared';

import { withDatabase } from './client';

/** The columns of `tax_rates` this module reads. */
export type TaxRateRow = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly ratePercent: string;
  readonly countryCode: string | null;
  readonly isDefault: boolean;
};

/**
 * A rate row as the domain's `TaxRate`, or `null` when the row is not a legal rate.
 *
 * `null` rather than a thrown error on purpose: one malformed row in the rate table must not make
 * every capture fail. The row is skipped and the extraction reports `TAX_RATE_ASSUMED` if the printed
 * percentage then matches nothing, which puts the problem in front of a human where it belongs.
 */
export function toDomainTaxRate(row: TaxRateRow): TaxRate | null {
  if (!isTaxCategory(row.category)) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    ratePercent: row.ratePercent,
    ...(row.countryCode === null ? {} : { countryCode: row.countryCode }),
  };
}

export type Tenant = {
  readonly companyId: string;
  readonly companyName: string;
  readonly currency: CurrencyCode;
  readonly countryCode: string;
  readonly taxRates: readonly TaxRate[];
  /** The rate extraction falls back to when a printed percentage matches nothing. */
  readonly defaultTaxRateId: string | undefined;
};

/**
 * The company's settings, or `null` when no such company exists.
 *
 * `null` (rather than throwing) is what lets "this session points at a deleted company" be handled as
 * a sign-out by the caller, instead of as an outage by the user.
 */
export async function loadTenant(companyId: string): Promise<Tenant | null> {
  return withDatabase(async (client) => {
    const company = await client.company.findUnique({
      where: { id: companyId },
      include: { taxRates: { orderBy: { code: 'asc' } } },
    });

    if (company === null) {
      return null;
    }

    const taxRates = company.taxRates
      .map((row) => toDomainTaxRate(row))
      .filter((rate): rate is TaxRate => rate !== null);

    const defaultRate =
      company.taxRates.find((row) => row.isDefault) ??
      company.taxRates.find((row) => row.category === 'STANDARD');

    return {
      companyId: company.id,
      companyName: company.name,
      currency: isCurrencyCode(company.currency) ? company.currency : 'EUR',
      countryCode: company.countryCode,
      taxRates,
      defaultTaxRateId: defaultRate?.id,
    };
  });
}

/** Guards the "a draft is only stored when a human could have saved it" rule in one place. */
export function assertSavable(draft: { readonly isSaveable: boolean }): void {
  if (!draft.isSaveable) {
    throw new DomainError(
      DomainErrorCode.INVALID_INVOICE,
      'kjo faturë ka ende probleme të pazgjidhura dhe nuk mund të ruhet',
    );
  }
}
