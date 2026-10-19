/**
 * Which side of the exchange an actor is on.
 *
 * An invoice is between two companies, but the counterparty does not have to be registered yet, so the
 * exchange is modelled over an `InvoiceParty` row (§4.2) that carries this role instead of a
 * `Company`. Every permission that depends on "whose invoice is it" — issue versus accept — is decided
 * by comparing this value, never by assuming the acting company is the supplier.
 */
export const PartyRole = {
  SUPPLIER: 'SUPPLIER',
  BUYER: 'BUYER',
} as const;

export type PartyRole = (typeof PartyRole)[keyof typeof PartyRole];

export const PARTY_ROLES: readonly PartyRole[] = Object.values(PartyRole);

export function isPartyRole(value: unknown): value is PartyRole {
  return typeof value === 'string' && (PARTY_ROLES as readonly string[]).includes(value);
}

/** The other side of the same relationship — used when a claim links two party rows (§4.2). */
export function counterpartyRole(role: PartyRole): PartyRole {
  return role === PartyRole.SUPPLIER ? PartyRole.BUYER : PartyRole.SUPPLIER;
}
