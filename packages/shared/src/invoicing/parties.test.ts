import { describe, expect, it } from 'vitest';

import { PARTY_ROLES, PartyRole, counterpartyRole, isPartyRole } from '../index';

describe('PartyRole', () => {
  it('has exactly the two sides of an invoice, and no more', () => {
    expect(PARTY_ROLES).toEqual(['SUPPLIER', 'BUYER']);

    for (const role of PARTY_ROLES) {
      expect(isPartyRole(role)).toBe(true);
    }
  });

  it('rejects anything else, so a role read from a request body is checked at the edge', () => {
    for (const value of ['supplier', 'CUSTOMER', 'Buyer ', '', null, undefined, 0, {}]) {
      expect(isPartyRole(value)).toBe(false);
    }
  });

  it('gives the other side of the same relationship, and gives it back again', () => {
    expect(counterpartyRole(PartyRole.SUPPLIER)).toBe(PartyRole.BUYER);
    expect(counterpartyRole(PartyRole.BUYER)).toBe(PartyRole.SUPPLIER);

    for (const role of PARTY_ROLES) {
      expect(counterpartyRole(counterpartyRole(role))).toBe(role);
      expect(counterpartyRole(role)).not.toBe(role);
    }
  });
});
