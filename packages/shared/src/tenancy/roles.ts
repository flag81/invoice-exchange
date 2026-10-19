/**
 * The roles a user can hold inside a company (§4.1).
 *
 * A `User` is a global identity; a `Membership` is `(userId, companyId, role)`. The role is a string from
 * this closed union rather than a database enum, so it is validated at the edges and stays greppable —
 * `Role.OWNER` shows up in a search, `"OWNER"` scattered through the code does not.
 *
 * The descriptions are the contract the permission matrix in `permissions.ts` implements:
 *
 * - `OWNER` — billing and destructive rights; can do everything.
 * - `ADMIN` — runs the company day to day, including invoices; not billing, not deletion.
 * - `ACCOUNTANT` — invoices, credit notes, exports and the audit trail; no settings.
 * - `ISSUER` — creates and edits drafts.
 * - `APPROVER` — the buyer's side: accepts, disputes, rejects.
 * - `VIEWER` — reads.
 */

export const Role = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  ACCOUNTANT: 'ACCOUNTANT',
  ISSUER: 'ISSUER',
  APPROVER: 'APPROVER',
  VIEWER: 'VIEWER',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const ROLES: readonly Role[] = Object.values(Role);

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** OWNER and ADMIN are the roles that may change company settings and manage members. */
export function isCompanyAdminRole(role: Role): boolean {
  return role === Role.OWNER || role === Role.ADMIN;
}
