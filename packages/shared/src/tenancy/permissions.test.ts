import { describe, expect, it } from 'vitest';

import {
  DomainErrorCode,
  PERMISSIONS,
  Permission,
  ROLES,
  Role,
  assertPermission,
  hasPermission,
  hasPermissionForAnyRole,
  isPermission,
  permissionsForRole,
  rolesWithPermission,
} from '../index';
import { expectDomainError } from '../testing/domain-error';

const OWNER = Role.OWNER;
const ADMIN = Role.ADMIN;
const ACCOUNTANT = Role.ACCOUNTANT;
const ISSUER = Role.ISSUER;
const APPROVER = Role.APPROVER;
const VIEWER = Role.VIEWER;

/** The matrix of §5.5, written out in full: what each role holds, and — by omission — what it does not. */
const MATRIX: Readonly<Record<Role, readonly Permission[]>> = {
  [OWNER]: PERMISSIONS,
  [ADMIN]: [
    Permission.COMPANY_VIEW,
    Permission.COMPANY_MANAGE,
    Permission.MEMBER_INVITE,
    Permission.MEMBER_MANAGE,
    Permission.TAX_RATE_MANAGE,
    Permission.AUDIT_VIEW,
    Permission.API_TOKEN_MANAGE,
    Permission.INVOICE_VIEW,
    Permission.INVOICE_CREATE,
    Permission.INVOICE_UPDATE,
    Permission.INVOICE_ISSUE,
    Permission.INVOICE_SEND,
    Permission.INVOICE_CANCEL,
    Permission.INVOICE_ACCEPT,
    Permission.INVOICE_DISPUTE,
    Permission.INVOICE_REJECT,
    Permission.INVOICE_MARK_PAID,
    Permission.CREDIT_NOTE_CREATE,
    Permission.EXPORT_CREATE,
    Permission.PARTY_MANAGE,
  ],
  [ACCOUNTANT]: [
    Permission.COMPANY_VIEW,
    Permission.AUDIT_VIEW,
    Permission.INVOICE_VIEW,
    Permission.INVOICE_CREATE,
    Permission.INVOICE_UPDATE,
    Permission.INVOICE_ISSUE,
    Permission.INVOICE_SEND,
    Permission.INVOICE_CANCEL,
    Permission.INVOICE_ACCEPT,
    Permission.INVOICE_DISPUTE,
    Permission.INVOICE_REJECT,
    Permission.INVOICE_MARK_PAID,
    Permission.CREDIT_NOTE_CREATE,
    Permission.EXPORT_CREATE,
    Permission.PARTY_MANAGE,
  ],
  [ISSUER]: [
    Permission.COMPANY_VIEW,
    Permission.INVOICE_VIEW,
    Permission.INVOICE_CREATE,
    Permission.INVOICE_UPDATE,
    Permission.PARTY_MANAGE,
  ],
  [APPROVER]: [
    Permission.COMPANY_VIEW,
    Permission.INVOICE_VIEW,
    Permission.INVOICE_ACCEPT,
    Permission.INVOICE_DISPUTE,
    Permission.INVOICE_REJECT,
  ],
  [VIEWER]: [Permission.COMPANY_VIEW, Permission.INVOICE_VIEW],
};

describe('the permission matrix (§5.5)', () => {
  it('is a closed, distinct set of permissions, and the guard accepts each one', () => {
    expect(PERMISSIONS).toHaveLength(22);
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);

    for (const permission of PERMISSIONS) {
      expect(isPermission(permission)).toBe(true);
    }
  });

  it('rejects anything else, so a permission read from a request is checked at the edge', () => {
    for (const value of ['invoice:approve', 'INVOICE_ISSUE', 'invoice:issue ', '', null, 1, {}]) {
      expect(isPermission(value)).toBe(false);
    }
  });

  it('matches the written-out matrix for every role, entry for entry', () => {
    for (const role of ROLES) {
      const expected = MATRIX[role];

      expect(permissionsForRole(role)).toEqual(expected);
      expect(permissionsForRole(role)).toHaveLength(expected.length);
    }
  });

  it('agrees with itself: hasPermission is exactly membership of the role row', () => {
    for (const role of ROLES) {
      for (const permission of PERMISSIONS) {
        expect(hasPermission(role, permission)).toBe(MATRIX[role].includes(permission));
      }
    }
  });

  it('gives the owner everything, including a permission added later', () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission(OWNER, permission)).toBe(true);
    }

    expect(permissionsForRole(OWNER)).toBe(PERMISSIONS);
    expect(rolesWithPermission(Permission.BILLING_MANAGE)).toEqual([OWNER]);
    expect(rolesWithPermission(Permission.COMPANY_DELETE)).toEqual([OWNER]);
  });

  it('keeps issuing away from the role that only drafts', () => {
    expect(hasPermission(ISSUER, Permission.INVOICE_CREATE)).toBe(true);
    expect(hasPermission(ISSUER, Permission.INVOICE_UPDATE)).toBe(true);
    expect(hasPermission(ISSUER, Permission.INVOICE_ISSUE)).toBe(false);
    expect(hasPermission(ACCOUNTANT, Permission.INVOICE_ISSUE)).toBe(true);
    expect(hasPermission(ADMIN, Permission.BILLING_MANAGE)).toBe(false);
    expect(hasPermission(ACCOUNTANT, Permission.COMPANY_MANAGE)).toBe(false);
  });

  it('lets every role read the company and its invoices, and nobody gains more by being listed twice', () => {
    expect(rolesWithPermission(Permission.INVOICE_VIEW)).toEqual([...ROLES]);
    expect(rolesWithPermission(Permission.COMPANY_VIEW)).toEqual([...ROLES]);

    for (const permission of PERMISSIONS) {
      const holders = rolesWithPermission(permission);

      for (const role of ROLES) {
        expect(holders.includes(role)).toBe(hasPermission(role, permission));
      }
    }
  });

  it('treats the buyer side as its own role, and lets an approver resolve a dispute either way', () => {
    expect(hasPermission(APPROVER, Permission.INVOICE_ACCEPT)).toBe(true);
    expect(hasPermission(APPROVER, Permission.INVOICE_DISPUTE)).toBe(true);
    expect(hasPermission(APPROVER, Permission.INVOICE_REJECT)).toBe(true);
    expect(hasPermission(APPROVER, Permission.INVOICE_ISSUE)).toBe(false);

    expect(rolesWithPermission(Permission.INVOICE_ACCEPT)).toEqual([
      OWNER,
      ADMIN,
      ACCOUNTANT,
      APPROVER,
    ]);
  });
});

describe('a membership can hold several roles', () => {
  it('takes a permission held by any one of them', () => {
    expect(hasPermissionForAnyRole([ISSUER, APPROVER], Permission.INVOICE_UPDATE)).toBe(true);
    expect(hasPermissionForAnyRole([ISSUER, APPROVER], Permission.INVOICE_ACCEPT)).toBe(true);
    expect(hasPermissionForAnyRole([ISSUER, APPROVER], Permission.INVOICE_ISSUE)).toBe(false);
  });

  it('denies by default: no roles, no permissions', () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermissionForAnyRole([], permission)).toBe(false);
    }
  });

  it('gives the same answer as asking each role on its own', () => {
    const combinations: readonly (readonly Role[])[] = [
      [],
      [VIEWER],
      [ISSUER],
      [ISSUER, VIEWER],
      [ACCOUNTANT, APPROVER],
      [ADMIN, VIEWER],
      ROLES,
    ];

    for (const roles of combinations) {
      for (const permission of PERMISSIONS) {
        expect(hasPermissionForAnyRole(roles, permission)).toBe(
          roles.some((role) => hasPermission(role, permission)),
        );
      }
    }
  });
});

describe('assertPermission, the check the server makes', () => {
  it('passes silently when any of the roles holds the permission', () => {
    expect(() => assertPermission([OWNER], Permission.COMPANY_DELETE)).not.toThrow();
    expect(() => assertPermission([ISSUER, APPROVER], Permission.INVOICE_ACCEPT)).not.toThrow();
  });

  it('refuses with the permission and the roles in the error, so a denial can be explained', () => {
    const error = expectDomainError(
      () => assertPermission([VIEWER], Permission.INVOICE_ISSUE),
      DomainErrorCode.PERMISSION_DENIED,
    );

    expect(error.message).toContain(Permission.INVOICE_ISSUE);
    expect(error.details).toEqual({ permission: Permission.INVOICE_ISSUE, roles: 'VIEWER' });
  });

  it('refuses a membership with no roles at all', () => {
    expectDomainError(
      () => assertPermission([], Permission.INVOICE_VIEW),
      DomainErrorCode.PERMISSION_DENIED,
    );
  });

  it('agrees with hasPermission for every role and every permission', () => {
    for (const role of ROLES) {
      for (const permission of PERMISSIONS) {
        if (hasPermission(role, permission)) {
          expect(() => assertPermission([role], permission)).not.toThrow();
          continue;
        }

        expectDomainError(
          () => assertPermission([role], permission),
          DomainErrorCode.PERMISSION_DENIED,
        );
      }
    }
  });
});
