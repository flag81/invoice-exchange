/**
 * The permission matrix (§5.5) — the single source of truth for who may do what.
 *
 * It is one table, read by three callers: the API layer (which throws), the UI (which hides controls) and
 * the tests (which pin the intent). Two properties of that arrangement matter:
 *
 * - **Hiding a button is never the control.** The UI uses `hasPermission` to decide what to render, and
 *   the use-case calls `assertPermission` with the same function, server-side. Deriving both from one row
 *   is what stops the two from disagreeing, which is the usual way a "hidden" action gets performed.
 * - **Default deny.** A permission that no row grants is granted to nobody; a use-case that forgets its
 *   check still fails closed, because the check lives with the data access rather than only at the route.
 *
 * The role lists below are written out in full instead of being computed from "everything except…" so
 * that a reviewer can read a role's rights in one screen and a new permission has to be granted
 * deliberately. `permissions.test.ts` pins each list.
 */

import { DomainErrorCode, fail } from '../errors';
import type { Role } from './roles';

export const Permission = {
  /** Read the company profile and its settings. */
  COMPANY_VIEW: 'company:view',
  /** Change company settings: name, tax ids, addresses, branding. */
  COMPANY_MANAGE: 'company:manage',
  /** Delete the company — destructive, never an accident. */
  COMPANY_DELETE: 'company:delete',
  /** Manage the subscription and billing details (owner only). */
  BILLING_MANAGE: 'billing:manage',
  MEMBER_INVITE: 'member:invite',
  /** Change or remove memberships, including other people's roles. */
  MEMBER_MANAGE: 'member:manage',
  /** Maintain the tenant's own tax rates. */
  TAX_RATE_MANAGE: 'tax-rate:manage',
  /** Read the append-only audit trail (§4.5). */
  AUDIT_VIEW: 'audit:view',
  /** Issue and revoke long-lived API tokens for the mobile app. */
  API_TOKEN_MANAGE: 'api-token:manage',

  INVOICE_VIEW: 'invoice:view',
  /** Create a draft. */
  INVOICE_CREATE: 'invoice:create',
  /** Edit a draft (the only editable status). */
  INVOICE_UPDATE: 'invoice:update',
  /** DRAFT → ISSUED: assign the number and lock the header. */
  INVOICE_ISSUE: 'invoice:issue',
  /** Hand the invoice to the buyer. */
  INVOICE_SEND: 'invoice:send',
  /** Void an invoice before the buyer has decided. */
  INVOICE_CANCEL: 'invoice:cancel',
  INVOICE_ACCEPT: 'invoice:accept',
  INVOICE_DISPUTE: 'invoice:dispute',
  INVOICE_REJECT: 'invoice:reject',
  /** ACCEPTED → PAID: the money arrived. */
  INVOICE_MARK_PAID: 'invoice:mark-paid',
  /** Correct an issued invoice without touching it (§4.5). */
  CREDIT_NOTE_CREATE: 'credit-note:create',
  /** Generate an export of invoices for an accountant or an authority. */
  EXPORT_CREATE: 'export:create',
  /** Create and maintain counterparty records (`InvoiceParty`, §4.2). */
  PARTY_MANAGE: 'party:manage',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export const PERMISSIONS: readonly Permission[] = Object.values(Permission);

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

/** Reading an invoice is the floor: every role that can see anything can see invoices. */
const READ_ONLY: readonly Permission[] = [Permission.COMPANY_VIEW, Permission.INVOICE_VIEW];

const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  // Owns the tenant, including billing and deletion. Written as `PERMISSIONS` on purpose: a new
  // permission belongs to the owner by default, and asking the owner to grant it to themselves first
  // would be a lockout waiting to happen.
  OWNER: PERMISSIONS,
  ADMIN: [
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
  ACCOUNTANT: [
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
  // "Creates draft invoices" (§4.1) — deliberately not `INVOICE_ISSUE`: issuing assigns a legal number,
  // which is an accountant's or an admin's act.
  ISSUER: [
    Permission.COMPANY_VIEW,
    Permission.INVOICE_VIEW,
    Permission.INVOICE_CREATE,
    Permission.INVOICE_UPDATE,
    Permission.PARTY_MANAGE,
  ],
  // The buyer's side. `INVOICE_REJECT` is included because resolving a dispute with a refusal is the
  // same buyer-side decision as disputing in the first place.
  APPROVER: [
    Permission.COMPANY_VIEW,
    Permission.INVOICE_VIEW,
    Permission.INVOICE_ACCEPT,
    Permission.INVOICE_DISPUTE,
    Permission.INVOICE_REJECT,
  ],
  VIEWER: READ_ONLY,
};

/** The permissions a single role holds, in the order the matrix lists them. */
export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

/** A membership can hold several roles; a permission held by any of them counts. */
export function hasPermissionForAnyRole(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => hasPermission(role, permission));
}

/** Every role that holds a permission — used to explain a denial and to audit who can do what. */
export function rolesWithPermission(permission: Permission): readonly Role[] {
  return (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((role) =>
    hasPermission(role, permission),
  );
}

/**
 * The server-side check. `apps/web` wraps this with the `TenancyContext` (§5.5:
 * `requirePermission(ctx, Permission.INVOICE_ISSUE)`) in phase 3; the rule itself lives here so the UI
 * and the API cannot drift apart.
 */
export function assertPermission(roles: readonly Role[], permission: Permission): void {
  if (!hasPermissionForAnyRole(roles, permission)) {
    fail(DomainErrorCode.PERMISSION_DENIED, `your role may not ${permission}`, {
      permission,
      roles: roles.join(', '),
    });
  }
}
