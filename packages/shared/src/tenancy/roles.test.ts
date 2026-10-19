import { describe, expect, it } from 'vitest';

import { ROLES, Role, isCompanyAdminRole, isRole } from '../index';

describe('Role', () => {
  it('is the six roles of §4.1, in one closed union', () => {
    expect(ROLES).toEqual(['OWNER', 'ADMIN', 'ACCOUNTANT', 'ISSUER', 'APPROVER', 'VIEWER']);

    for (const role of ROLES) {
      expect(isRole(role)).toBe(true);
    }
  });

  it('rejects anything else, so a role arriving in a request body is checked', () => {
    for (const value of ['owner', 'SuperAdmin', 'OWNER ', '', null, undefined, 3, {}]) {
      expect(isRole(value)).toBe(false);
    }
  });

  it('counts OWNER and ADMIN — and only those two — as company administrators', () => {
    for (const role of ROLES) {
      expect(isCompanyAdminRole(role)).toBe(role === Role.OWNER || role === Role.ADMIN);
    }

    expect(isCompanyAdminRole(Role.ACCOUNTANT)).toBe(false);
    expect(isCompanyAdminRole(Role.ISSUER)).toBe(false);
  });
});
