# ADR 0003 — Tenant isolation: shared schema, mandatory tenancy context, scoped client

- **Status**: accepted (phase 0), implemented in phase 2
- **Date**: 2026-10-16

## Context

The platform is multi-tenant: many companies, each with users, invoices and counterparties. A single
leaked tenant filter is a data breach, so "don't forget the `where` clause" is not an acceptable
control. Options considered: one database per tenant (operationally heavy, migrations × N), schema
per tenant (Prisma-unfriendly), shared schema with a discriminator column (the usual choice), plus
Postgres row-level security on top.

## Decision

Shared schema, `companyId` on every tenant-owned table, and **the tenant context is a required first
argument everywhere**:

1. `TenancyContext` (`actorUserId`, `companyId`, `roles`, `permissions`, `requestId`) is resolved
   server-side from the session/bearer token plus a verified `Membership` row. A company id sent by
   the client is a request, never a fact.
2. Every repository function takes `ctx` first (`listInvoices(ctx, filter)`); there is no overload
   without it, and no "global" query helper exists.
3. `packages/db/src/client.ts` exposes `forTenant(ctx)`, a Prisma client extended so that tenant-owned
   models always carry `companyId = ctx.companyId` in reads and writes. Forgetting the filter in a
   query still yields tenant-scoped SQL.
4. Cross-tenant access returns `404`, never `403` — a `403` confirms the record exists.
5. Authorisation is checked in the use-case (`requirePermission(ctx, …)`) so the same call fails
   closed for HTML, JSON and job-driven paths.
6. Row-level security is available as a Phase 5 addition (`SET LOCAL app.company_id` per
   transaction) — the schema is designed so that the RLS policies are a migration, not a redesign:
   every tenant table already has `companyId` and every access path already goes through `forTenant`.

## Consequences

- A developer who forgets the tenant filter gets tenant-scoped results anyway (wrong-but-safe), and
  the boundary tests catch the logic error.
- Every function signature is slightly noisier; the payoff is that tenancy is impossible to bypass by
  accident.
- A hostile-tenant test suite is mandatory: each endpoint is called with tenant A's token against
  tenant B's ids and must 404.

## Alternatives rejected

- **Database per tenant** — connection pooling, migration fan-out and cost make it wrong at this size.
- **Postgres RLS only, no application layer** — the app-level context is still needed to set the
  session variable, and RLS alone gives no defence against a missing permission check.
- **Prisma middleware (`$use`)** — removed in current Prisma versions and string-matching based;
  client extensions are typed and explicit.
