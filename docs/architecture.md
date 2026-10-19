# Architecture

Status: living document. Phase 0 (skeleton) is implemented; later phases are described here before
they are built so that every decision has a written home.

## 1. What the product is

A **B2B invoice exchange** for two kinds of registered companies:

- **Suppliers** issue invoices to buyers.
- **Buyers** receive them, approve or dispute them, and both sides keep an immovable record.

Both parties are users of the platform, which is what makes this different from a generic billing
tool: an invoice is not a PDF you email, it is a **shared, stateful, versioned record** with a
lifecycle (`DRAFT → ISSUED → SENT → DELIVERED/VIEWED → ACCEPTED | DISPUTED | REJECTED → PAID`,
plus `CANCELLED` and credit-note corrections), an append-only audit trail, and a legal document
version that is regenerated — never edited — whenever the invoice changes.

Out of scope for the first delivery: real-time e-invoicing network interop (PEPPOL/AS4 gateways),
bank payment initiation, and marketplace escrow.

## 2. Locked stack

Chosen against the versions actually published at bootstrap time (verified on the npm registry, not
assumed):

| Concern         | Choice                                 | Version      | Why                                                                                          |
| --------------- | -------------------------------------- | ------------ | -------------------------------------------------------------------------------------------- |
| Runtime         | Node.js                                | 22.x         | LTS-line, native `fetch`, `crypto.randomUUID`                                                |
| Package manager | pnpm workspaces + turbo                | 9.15 / 2.11  | strict `node_modules`, fast cached tasks                                                     |
| Language        | TypeScript                             | **5.9.3**    | newest release supported by `typescript-eslint` (peer `<6.1.0`; TS 7 is out and unsupported) |
| Web framework   | Next.js App Router                     | 16.4.2       | RSC, route handlers, server actions; one deployable for UI + API                             |
| UI runtime      | React / React DOM                      | 19.3.1       | required by Next 16                                                                          |
| ORM             | Prisma + `@prisma/client`              | **7.10.1**   | the `latest` tag is an 8.0 RC; 7.10.1 is the stable CLI/client pair                          |
| Database        | PostgreSQL                             | 15+          | transactions, `numeric`, partial/unique indexes, optional RLS                                |
| Validation      | Zod                                    | 4.x          | HTTP boundary only (never inside `packages/shared`)                                          |
| Money           | `BigInt` minor units + `decimal.js`    | 10.6.0       | integers for storage, exact decimal math for percentages                                     |
| JWT             | `jose`                                 | 6.x          | RS256 access tokens for mobile, no deprecated dependencies                                   |
| Password hash   | `@node-rs/argon2`                      | 2.2.2        | argon2id, prebuilt win32/linux binaries (no compiler needed)                                 |
| Tests           | Vitest (+ `@vitest/coverage-v8`)       | 5.0.5        | TS-first, fast; `vite` 8 is a required peer                                                  |
| Lint            | ESLint flat config + typescript-eslint | 10.13 / 8.71 | single root config, boundary rules as errors                                                 |
| Styling         | Tailwind CSS                           | 4.3.3        | added in phase 3 with the app shell                                                          |
| PDF             | `@react-pdf/renderer`                  | 4.9.0        | pure-JS, React 19 compatible; no headless browser                                            |
| Spreadsheets    | `exceljs`                              | 4.4.0        | MIT, streaming writer, used by the export job                                                |
| Logging         | `pino`                                 | 10.x         | structured JSON logs with request ids                                                        |
| Mail            | `nodemailer`                           | 10.x         | SMTP transport, driven by the outbox                                                         |

Deliberately **not** used: `arctic` (deprecated — see ADR 0002), NextAuth/Auth.js (opinionated
against multi-tenant + mobile), `passport` (session middleware we do not need), `pdfkit`
(imperative layout, harder to test than JSX templates), `bullmq`/Redis (phase 7 needs a job runner,
not a scheduler — a Postgres outbox + worker is enough until it is not).

## 3. Repository layout and package boundaries

```
apps/web/                     Next.js application. UI (RSC) + HTTP API (route handlers) + server actions.
  src/app/                    routes; route handlers under src/app/api/**
  src/server/                 server-only: auth, tenancy resolution, services, use-cases, job enqueue
  src/components/             shared UI components (client + server)
  src/lib/                    framework glue, env parsing, formatting helpers used by UI
apps/worker/                  (phase 7) outbox consumer: mail, PDF render, exports, AI extraction
packages/shared/              the domain core. No framework, no Node built-ins, no Prisma, no zod.
  src/money.ts                minor-unit arithmetic and rounding rules
  src/tax.ts                  per-line VAT, tax categories, rounding policy for totals
  src/totals.ts               document totals: line -> document -> payable amount
  src/invoicing/              invoice lifecycle state machines + guards
  src/exchange/               buyer/supplier exchange status machine + permissions per state
  src/tenancy/                TenancyContext type, role/permission matrix, membership rules
  src/validation/             hand-written invariant checks (no dependencies)
  src/format/                 locale-aware number/date/IBAN/VAT-id formatting
packages/db/                  Prisma schema, migrations, generated client, tenant-scoped client,
                              repositories (each takes TenancyContext first), seed script
packages/api-client/          typed `fetch` client for the public HTTP API. Runs in browser and in
                              React Native; contains no React, no Node, no server imports
packages/pdf/                 deterministic invoice document renderer (templates + shared helpers)
docs/adr/                     decision records
```

### Import rules (enforced by `eslint.config.mjs`)

| Package               | May import                                                                  |
| --------------------- | --------------------------------------------------------------------------- |
| `packages/shared`     | nothing but itself                                                          |
| `packages/db`         | `shared`, `@prisma/client`                                                  |
| `packages/pdf`        | `shared`, `@react-pdf/renderer`                                             |
| `packages/api-client` | `shared` (types only), global `fetch`                                       |
| `apps/web`            | everything above, but `src/server/**` is unreachable from client components |
| `apps/worker`         | everything above, never `apps/web` internals                                |

Packages are consumed **as TypeScript source** (`exports` point at `src/index.ts`, no build step) and
Next transpiles them via `transpilePackages`. This removes an entire class of "stale dist" bugs
during development; when the worker or an npm publish needs real artifacts, that package gets an
explicit `build` script.

Notable deviation from the original plan: there is **no `packages/config`**. Config-by-package
indirection (tsconfig presets behind `exports` maps) adds resolution subtleties for no benefit at
this size; packages extend the root `tsconfig.base.json` by relative path and share one root ESLint
config. Extract a config package only if `apps/mobile` (Expo) needs a genuinely different base.

## 4. Domain model

Everything below lives in `packages/db/prisma/schema.prisma` (phase 2). Names are chosen so that the
database reads like the business.

### 4.1 Actors

| Model          | Purpose                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `Company`      | The tenant. Flagged `isSupplier` / `isBuyer`; one company can be both.                           |
| `User`         | A global identity (email + optional password). A user is not "inside" a company.                 |
| `Membership`   | `(userId, companyId, role)` — the join that makes a user an actor inside a tenant.               |
| `Invitation`   | Pending `Membership`, with a single-use token and an expiry.                                     |
| `OAuthAccount` | `(provider, providerAccountId) → user`, plus the encrypted refresh token for Facebook.           |
| `OAuthState`   | Short-lived, single-use PKCE/state/nonce row; consumed on callback.                              |
| `Session`      | Server-side session: hashed token, IP, user agent, absolute + idle expiry, `revokedAt`.          |
| `ApiToken`     | Long-lived refresh token for the mobile app; rotated on every use, reuse ⇒ whole family revoked. |

Roles are **not** an enum in the database either; they are a string from a closed union in
`packages/shared/src/tenancy/roles.ts`, validated at the edges:

`OWNER` (billing + destructive rights) · `ADMIN` · `ACCOUNTANT` (deals with invoices, no settings) ·
`ISSUER` (creates draft invoices) · `APPROVER` (buyer side: accept/dispute) · `VIEWER`.

Permissions are a matrix in `packages/shared/src/tenancy/permissions.ts` — the single source of truth
used by the API layer, the UI (to hide controls) and the tests. Hiding a button is never the
control; the API checks the same function server-side.

### 4.2 The counterparty primitive: `InvoiceParty`

An invoice is between two companies, but the counterparty does not have to be registered yet. So the
exchange is modelled over a **party**, not over a `Company`:

```
InvoiceParty {
  id
  companyId            // the tenant that owns this row (the "viewer" side)
  role                 // SUPPLIER | BUYER
  kind                 // COMPANY | INDIVIDUAL
  linkedCompanyId?     // set once the counterparty registers and claims the record
  name, taxId?, vatId?, registrationNumber?, address*, contactEmail?
  createdById
}
```

`Invoice.supplierPartyId` / `Invoice.buyerPartyId` point at these rows, and both sides get their own
`InvoiceParty` row for the same commercial relationship. When the counterparty registers, a **claim**
links `linkedCompanyId` and the existing invoices become visible to them without rewriting records.
This is what makes "invite your buyer, they sign up later" work without a migration of ownership.

### 4.3 Invoice, lines, versions

| Model              | Notes                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `Invoice`          | Header: parties, currency, issue/due dates, status, `number?`, totals snapshot, `lockedAt`.                                     |
| `InvoiceLine`      | `quantity` (decimal 4dp), `unitPriceMinor` (BigInt), `unit?`, `taxRateId`, discounts, `lineTotalMinor`, `taxMinor`, `position`. |
| `InvoiceVersion`   | Immutable legal snapshot: `version`, `snapshotJson`, `totalsJson`, `documentHash`, `pdfBlobId`, `reason`, `createdById`.        |
| `InvoiceExchange`  | The buyer/supplier interaction state for the invoice (see 4.5).                                                                 |
| `DocumentBlob`     | A stored artifact (rendered PDF, buyer-uploaded PO, credit note) — never a public URL.                                          |
| `CreditNote`       | Negative document that references the invoice it corrects; own number sequence.                                                 |
| `Payment`          | Recorded payment against an invoice (`amountMinor`, `paidAt`, `method`, `reference?`).                                          |
| `PurchaseOrderRef` | Optional buyer-side PO number required before acceptance.                                                                       |

Invariants enforced in both layers (TypeScript guard + database constraint) — a violation is a bug,
not a validation message:

1. An invoice belongs to exactly one supplier company and one buyer company, and
   `supplierCompanyId !== buyerCompanyId`.
2. `sum(line.lineTotalMinor) = invoice.subtotalMinor`; `subtotal + tax − discount = total`.
3. If `invoice.status !== DRAFT` then `invoice.number IS NOT NULL`, `lockedAt IS NOT NULL` and a
   corresponding `InvoiceVersion` with `version = 1` exists.
4. Every status transition is present in `packages/shared/src/invoicing/transitions.ts`; anything not
   in the table throws.
5. `InvoiceVersion` rows are append-only: the repository has no update/delete method for them and
   the database role the app uses is granted `SELECT, INSERT` only on that table in production.

### 4.4 Money, tax and numbering

**Money.** Amounts are stored as integer minor units in `BigInt` and rendered through
`packages/shared/src/money.ts`. Percentages and quantities are `decimal.js` `Decimal`s with an
explicit scale (quantity 4 dp, rate 4 dp). The rounding policy — round half-up, per line, then sum —
lives in one place (`shared/src/totals.ts`) and is covered by property-based tests
(`fast-check`) so that "the totals add up" is a proven property rather than a hope:

- `lineTotalMinor = round(unitPriceMinor * quantity) − lineDiscountMinor`
- `taxMinor = round(lineTotalMinor * taxRate)`, netted per tax category
- `totalMinor = subtotalMinor + taxMinor − documentDiscountMinor`
- `payableMinor = totalMinor − sum(payments.amountMinor)`

**Tax.** `TaxRate { companyId, name, rate, category (STANDARD|REDUCED|ZERO|EXEMPT|REVERSE_CHARGE),
countryCode, isDefault }`. The document snapshots the rates it used into `InvoiceVersion.totalsJson`,
so an invoice is reproducible years later even if the tax table changes. Defaults shipped for Kosovo
(VAT 18%/8%, tax-exempt export rules) as seed data — not hard-coded in the domain, so other locales
are a data change.

**Numbering.** `Sequence { companyId, kind, prefix, pattern, periodKey, nextValue }` where `periodKey`
is e.g. `2026` or `2026-10`. Allocation happens **inside the same transaction** as the invoice write:

```sql
UPDATE "Sequence" SET "nextValue" = "nextValue" + 1
WHERE "companyId" = $1 AND "kind" = $2 AND "periodKey" = $3
RETURNING "nextValue";
```

plus a unique index on `(companyId, kind, periodKey, sequenceNumber)` as the backstop, plus
`(companyId, number)` on the invoice. Numbers are never reused, never written by hand, and a
rolled-back transaction rolls back the increment too (no gaps from failures, gaps only from
deliberate cancellation, which is what fiscal rules expect).

### 4.5 The exchange lifecycle

`Invoice.status` (supplier's view of reality) and `InvoiceExchange.status` (the interaction) are
separate on purpose, because a PDF-only invoice has a lifecycle too and the buyer side is multi-party.

```
DRAFT ──issue──> ISSUED ──send──> SENT ──viewed──> DELIVERED ──┬─> ACCEPTED ──> PAID
   │                                                │           └─> DISPUTED ──> (resolved) ──> ACCEPTED|REJECTED
   └─cancel──> CANCELLED <──────────────────────────────────────┘
ISSUED|SENT|DELIVERED|ACCEPTED|DISPUTED ──correct──> CREDIT_NOTE issued (original unchanged)
```

Rules encoded in `shared/src/invoicing/transitions.ts` and `shared/src/exchange/`:

- Draft is the only editable state; issuing locks the header.
- A change to a locked invoice creates a **new version** and an audit event, never an edit.
- Only the buyer's company may `ACCEPT`/`DISPUTE`/`REJECT`; only the supplier's may `SEND`/`CANCEL`.
- `DISPUTED` requires a reason; the reason is part of the audit record and is emailed.
- `PAID` is a supplier decision (they know whether the money arrived) and is derived from payments
  when payments are recorded.
- Every transition writes an `AuditEvent` row (actor, from, to, reason, IP, request id, timestamp) in
  the same transaction. The audit table is append-only by application code and by grants.

### 4.6 Tenancy pipeline (the rule that keeps tenants apart)

```ts
export type TenancyContext = {
  actorUserId: string;
  companyId: string; // the tenant acting right now
  roles: readonly Role[]; // roles within that company
  permissions: ReadonlySet<Permission>;
  requestId: string; // correlates logs, audit rows and errors
};
```

1. A request arrives → session (or bearer token) resolves to `actorUserId`.
2. The **active company** comes from the session's `activeCompanyId`, or from an explicit
   `X-Company-Id` header, or from the URL (`/c/[companySlug]/...`) for HTML routes.
3. `resolveTenancy()` verifies a `Membership` exists for `(actorUserId, companyId)` (and that the
   membership is active) — a tenant id from the client is a _request_, not a fact.
4. Services receive `TenancyContext` and pass it to repositories, which take it as the **first
   argument**: `listInvoices(ctx, filter)`. There is no repository method without a `ctx`.
5. `packages/db/src/client.ts` returns a Prisma client extended so that `invoiceParty`, `invoice`,
   `sequence`, `membership` etc. always apply `companyId = ctx.companyId`; cross-tenant rows are
   unreachable even if a developer forgets the `where` clause.
6. E2E tests include a "hostile tenant" suite: every list/detail/update endpoint is called with a
   token from tenant A against resources of tenant B and must return `404` (never `403`, which would
   leak existence).

## 5. Authentication and authorisation

### 5.1 Identity core

Authentication is **ours** (ADR 0002): `User.email` (unique, case-insensitive), optional
`passwordHash` (argon2id via `@node-rs/argon2`), and zero or more `OAuthAccount` rows. Sign-in
methods are therefore additive rather than exclusive:

- Google account + password set later — supported.
- Two Google accounts with different emails — two identities, both can be explicit-linked.
- Automatic linking happens **only** when the provider reports a verified email that exactly matches
  an existing verified email; any mismatch creates a new identity. This is the rule that keeps
  account-takeover-via-provider out of the product.
- Facebook does not always return an email and never returns a verified one in the OIDC sense, so a
  Facebook sign-in without a matching linked account goes through a "confirm your email" step before
  the identity becomes usable.

### 5.2 OAuth, implemented on `fetch` (no framework, no `arctic`)

| Route                                     | Responsibility                                                                                                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/auth/oauth/[provider]/start`    | Create `OAuthState` (state, PKCE `code_verifier`, nonce, `returnTo`), set a short-lived HttpOnly cookie, redirect to the provider.                                               |
| `GET /api/auth/oauth/[provider]/callback` | Compare cookie vs query `state`, consume the row (single use, 10 min TTL), exchange the code (PKCE), validate the id token, upsert `OAuthAccount`, create the session, redirect. |
| `GET /api/auth/session`                   | Current user + memberships + `activeCompanyId`.                                                                                                                                  |
| `POST /api/auth/logout`                   | Revoke the session row and clear the cookie.                                                                                                                                     |
| `POST /api/auth/link/[provider]`          | Attach a provider to the signed-in identity (requires the current password or a fresh session).                                                                                  |

Provider specifics live in `apps/web/src/server/auth/providers/{google,facebook}.ts` with a shared
`OAuthProvider` interface (`authorizeUrl`, `exchangeCode`, `verifyIdToken | fetchUserInfo`):

- **Google**: OIDC discovery → authorize endpoint with `code_challenge`, `nonce`, `prompt=consent`;
  token exchange returns `id_token`, verified as RS256 against the JWKS with `iss`, `aud`, `exp` and
  `nonce` checks (`jose`). Email is trusted only when `email_verified === true`.
- **Facebook**: OAuth dialog + `graph.facebook.com/{version}/oauth/access_token`, then
  `/me?fields=id,name,email` with `appsecret_proof` (HMAC-SHA256 of the access token keyed by the app
  secret); no id token, so claims come from the Graph API and the email is treated as unverified.

Facebook demands `https` redirect URIs even on localhost, which is why `pnpm dev:https` exists.

### 5.3 Sessions, CSRF and tokens

- **Web session**: 256-bit random token, only its SHA-256 stored; cookie `ie_session`
  (`HttpOnly`, `SameSite=Lax`, `Secure` in production, path `/`). Absolute lifetime 30 days, idle
  timeout 30 minutes. Rotated on sign-in, on password change, and on active-company switch.
- **CSRF**: every cookie-authenticated mutation requires a double-submit token (`ie_csrf` cookie +
  `X-CSRF-Token` header) and an `Origin`/`Sec-Fetch-Site` check. `SameSite=Lax` alone is not treated
  as sufficient.
- **API/bearer (mobile, integrations)**: RS256 access JWT (15 min, `sub`, `sid`, `cid` = active
  company) plus an opaque rotating refresh token. Refresh tokens are stored hashed with a family id;
  **reusing a rotated token revokes the entire family** — the standard response to a stolen token.
- Signing keys come from `AUTH_JWT_PRIVATE_KEY`/`AUTH_JWT_PUBLIC_KEY` (base64 PKCS#8/SPKI), so the
  JWKS endpoint can be served without the private key ever leaving the server.

### 5.4 Passwords, reset and abuse controls

- argon2id (64 MiB, t=3, p=1 — tuned in one constant, benchmarked at start-up), never logged.
- Password reset and email verification: 32-byte single-use token, SHA-256 stored, 30-minute expiry,
  invalidated on use and on password change.
- Sign-in is rate limited per `(email)`, per `(ip, route)` and globally; failures are recorded in
  `AuditEvent` (login.failed) so that "was this an attack?" is answerable.
- Rate limiting is a Postgres fixed-window table (`RateLimit`) with a swap-in interface for Redis
  later — one dependency less until it is actually needed.

### 5.5 Authorisation

`requirePermission(ctx, Permission.INVOICE_ISSUE)` is called at the top of every use-case; the same
`hasPermission()` function drives UI affordances. Default deny: a use-case that forgets the check
fails closed, because the capability check lives with the data access, not only at the route.

## 6. HTTP API conventions

JSON endpoints live under `/api/v1/**` (route handlers); HTML is rendered by RSC and mutated with
server actions that call the same use-cases — one implementation, two presentations.

- **Errors** are a single envelope: `{ error: { code, message, details?, requestId } }`. `code` comes
  from a closed union in `packages/shared/src/http/codes.ts` (`VALIDATION_FAILED`,
  `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `STATE_CONFLICT`, `RATE_LIMITED`,
  `INTERNAL`), and every code maps to one HTTP status in exactly one place. `requestId` is echoed in
  the response header and appears in the logs, so a user report is traceable.
- **Validation** is Zod at the edge only: parse the request into a typed command, then hand it to the
  domain. A parse failure is a 400 with field-level `details`, never a stack trace, and internal
  error messages (Prisma, driver) are never forwarded — 500s return `INTERNAL` plus `requestId`.
- **Idempotency**: every non-idempotent endpoint accepts `Idempotency-Key`. The unique index on
  `(companyId, key)` plus a stored `requestHash` means: same key + same body ⇒ the original response
  is replayed (with `Idempotency-Replayed: true`), same key + different body ⇒ `409 CONFLICT`.
  Twenty-four hour retention. The header is _convenience_; the database constraint is the guarantee.
- **Concurrency**: mutable resources carry a `version` integer. Mutations must send it (`If-Match` or
  body field); a mismatch returns `409 STATE_CONFLICT` instead of silently overwriting someone else's
  edit. This matters most for the draft editor and for status transitions, which are also guarded by
  the state machine and by compare-and-set `UPDATE ... WHERE status = $expected`.
- **Pagination** is cursor-based (opaque base64 of `(createdAt, id)`), `limit` default 25, max 100.
  Offset pagination is not offered for ledgers; totals are computed by a dedicated aggregate endpoint
  so lists stay cheap.
- **Filtering/sorting** use per-resource allowlists (a typed `sort=` field map) so a query string can
  never reach Prisma as a raw column name.
- **Caching**: authenticated JSON is `Cache-Control: no-store`. Immutable artifacts (rendered PDFs for
  a specific version) are cacheable by hash.
- **Files never stream through the app**: `GET /api/v1/documents/{id}/download` verifies permission
  and returns a `302` to a short-lived presigned URL.
- **OpenAPI**: the Zod schemas generate `/api/openapi.json`, and `packages/api-client` is written
  against that contract, which is how the mobile app stays in sync without code generation traps.

## 7. Asynchronous work: the transactional outbox

Anything slow or unreliable — email, PDF rendering, exports, webhooks, AI extraction, reminders — is
queued in the database **in the same transaction as the business write**:

```
OutboxEvent { id, companyId?, type, payloadJson, status, attempts, availableAt,
              lockedBy?, lockedAt?, lastError?, dedupeKey (unique), createdAt, completedAt? }
```

- Producer: `await enqueue(tx, { type: 'invoice.send', payload, dedupeKey })` inside the transaction
  that changed the invoice. If the transaction rolls back, no email is queued; if it commits, the job
  survives a process crash. No "fire and forget" `fetch` to a mail provider anywhere in the codebase.
- Consumer: `apps/worker` claims a batch with `SELECT ... FOR UPDATE SKIP LOCKED` (Postgres-native
  queueing, safe with several worker replicas), executes, marks `DONE`, and on failure reschedules
  with exponential backoff and jitter. After N attempts the row becomes `DEAD` and raises an alert
  row visible in the admin UI; nothing is silently dropped.
- Handlers are idempotent by contract (keyed on `dedupeKey` + the business uniqueness constraints), so
  at-least-once delivery is safe.
- `JOBS_INLINE=true` runs the same handlers synchronously in dev/CI so the app is fully functional
  without a second process.
- Reminders (due soon, overdue, dispute follow-up) are produced by a single scheduler tick inside the
  worker that inserts deduped events — one less moving part than an external cron service, and it is
  the same at-least-once machinery.

## 8. Documents and PDFs

- `DocumentBlob { id, companyId, kind, storageKey, mime, sizeBytes, sha256, createdById, createdAt }`
  records every artifact; `storageKey` is never exposed to a client.
- Storage is a private S3-compatible bucket (S3/R2/MinIO) with versioning and server-side encryption
  enabled. Access is only ever through short-lived presigned URLs (60 s read; write URLs bound to a
  content type and a size limit). Local development uses a filesystem driver behind the same
  `StorageDriver` interface.
- Keys are namespaced `companyId/yyyy/mm/uuid` so a bucket listing is already tenant-scoped and a
  leaked key is useless without a signature.
- The rendered invoice PDF for a version is written once and referenced by `InvoiceVersion.pdfBlobId`;
  editing the invoice produces a new version and a new PDF. `documentHash` (SHA-256 of the bytes) is
  stored so later tampering is detectable, and the audit trail records who generated it.
- Rendering lives in `packages/pdf` (ADR 0005): deterministic JSX templates, no network access, no
  fonts fetched at runtime, fixed locale and timezone inputs, so the same version always yields
  byte-identical output — which is what makes the hash meaningful. A rendering spike is a Phase 0/4
  gate precisely because "pure JS PDF" is the assumption most likely to need a fallback.

## 9. Security controls (what a reviewer should check)

| Threat                          | Control                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cross-tenant read/write         | Tenancy context on every repository call + tenant-scoped Prisma extension + hostile-tenant tests                                                                                     |
| IDOR                            | Resource ids are always resolved _within_ the tenant scope; misses return `404`, never `403`                                                                                         |
| Privilege escalation            | Permission matrix in `shared`, checked server-side in the use-case; role changes are OWNER-only, audited, and take effect on the next request (no cached permissions in the session) |
| Mass assignment                 | Zod schemas are allowlists with `.strict()`; unknown fields are rejected, `companyId`/`status`/`number` are never client-settable                                                    |
| Invoice/number tampering        | Server-side number allocation, immutable versions, `documentHash`, append-only audit, DB `INSERT`-only grants for history tables                                                     |
| Session theft                   | HttpOnly cookie, hashed tokens, rotation, revoke-all, idle timeout, bind-on-refresh for mobile                                                                                       |
| CSRF                            | Double-submit token + Origin/Sec-Fetch-Site check on all cookie-authenticated mutations                                                                                              |
| XSS                             | React escaping by default, no `dangerouslySetInnerHTML` outside a sanitized rich-text allowlist, CSP with nonces, `X-Content-Type-Options: nosniff`                                  |
| SSRF (webhooks, provider calls) | Egress URLs are validated against an allowlist of schemes/hosts, no redirects followed, responses size-capped                                                                        |
| Secret leakage                  | Provider refresh tokens encrypted at rest (AES-256-GCM with `ENCRYPTION_KEY`); secrets only from env; nothing sensitive rendered into HTML or logs                                   |
| Log injection / PII in logs     | pino with redaction of `password`, `token`, `cookie`, `authorization`, tax ids are truncated                                                                                         |
| Brute force                     | Rate limits on auth routes, per-email lockout with exponential delay, audit records for failures                                                                                     |
| Malicious uploads               | Size caps, MIME sniffing on the stored bytes, keys server-generated, no execution, private bucket                                                                                    |
| Supply chain                    | Committed lockfile, `pnpm audit` in CI, minimal dependency set (see §2's "not used" list)                                                                                            |

Transport security: HSTS in production, `Secure` cookies, TLS-only OAuth redirects, and no mixed
content. Deployments run the web app and the worker from the same image with different commands, and
only the web app is reachable from the internet.

## 10. Testing strategy

| Layer                      | What it covers                                                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (`shared`)            | Money rounding, tax per category, totals invariants (property-based with `fast-check`), every allowed/forbidden state transition, permission matrix, formatters                                             |
| Integration (`db`)         | Repositories against a real Postgres: tenant isolation, atomic numbering under concurrency, unique constraints (duplicate invoice number, duplicate idempotency key, double issue), append-only enforcement |
| API (`web`)                | Route handlers and server actions invoked directly with fabricated sessions: authz matrix, error envelope, idempotent replay, optimistic-locking conflicts, hostile tenant                                  |
| E2E (Playwright, phase 3+) | The journeys that define the product: sign up → create company → invite buyer → draft → issue → send → buyer accepts → mark paid, plus password reset and OAuth round-trip with a stubbed provider          |
| Regression fixtures        | A single `@einv/db/testing` factory (`createCompanyWithUser`, `createIssuedInvoice`, …) used by every suite, so tests never hand-assemble domain state                                                      |

Gates: `shared` ≥ 95 % lines, `db` and API layers ≥ 80 %, no numeric gate on UI code (it is covered
by E2E). CI runs lint, typecheck, unit, integration (Postgres service container) and a production
build; `prisma migrate diff --exit-code` fails the build when the schema and migrations disagree.

## 11. Delivery phases

| Phase | Scope                                                                                                                                                                                                         | Exit gate                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **0** | Workspace skeleton: pnpm + turbo, root tsconfig, flat ESLint with boundary rules, Prettier, `.env.example`, docs/ADRs, minimal Next app on port 3001 with `/api/health`, one smoke test per package. _(done)_ | `pnpm install && pnpm lint && pnpm typecheck && pnpm test` green from a clean checkout |
| **1** | `packages/shared`: money, tax, totals, invoice + exchange state machines, permissions, formatters, invariant checks.                                                                                          | ≥ 95 % coverage, property tests for totals, exhaustive transition tests                |
| **2** | `packages/db`: full schema, first migration, tenant-scoped client, repositories, seed, dev database, integration test harness.                                                                                | Integration suite green including concurrent numbering and hostile-tenant cases        |
| **3** | Web auth + shell: password sign-in, Google and Facebook OAuth, sessions/CSRF/rate limits, company onboarding and invitations, Tailwind app shell, error envelope, request logging.                            | E2E: sign-up, sign-in, OAuth (stubbed provider), invite + accept                       |
| **4** | Invoices and the exchange: draft editor, issue + numbering, PDF render and document order, send via outbox, buyer accept/dispute, payments, credit notes, list/export.                                        | E2E: full supplier→buyer journey on a seeded database                                  |
| **5** | Hardening: DB grants, optional RLS, audit viewer, backup/restore drill, observability dashboards, load smoke test, security checklist walkthrough.                                                            | Security checklist signed off; restore drill performed                                 |
| **6** | Integrations: public API keys + webhooks, counterparty import (CSV/XLSX), accounting export, fiscal adapters behind interfaces.                                                                               | Partner sandbox exchange works end-to-end                                              |
| **7** | `apps/worker` + AI: outbox consumer in its own process, reminders/digests, PDF and export jobs, AI extraction and product matching with budget caps and a human review queue.                                 | Worker survives kill/restart with no lost jobs; AI output always human-confirmed       |
| **8** | Mobile: React Native client on `packages/api-client` + bearer tokens, offline draft capture.                                                                                                                  | Store-ready build of the read/approve flow                                             |

Review pause points: **after Phase 4** (product is genuinely usable end-to-end) and after Phase 6.

**Shipped ahead of the order above:** a vertical _capture_ slice (phases 2, 4 and 7 cut thin) — upload a
photographed supplier invoice, read it with a provider-agnostic extractor, review every number, and store
exact totals. It exists to prove the pipeline before the breadth of phase 2 lands, and it is described in
[`mvp.md`](mvp.md), including the rules it already keeps and the shortcuts it knowingly takes. The two
decisions it forced are recorded in [ADR 0006](adr/0006-scaled-integer-money.md) (scaled-integer money
instead of `decimal.js`), [ADR 0007](adr/0007-albanian-ui.md) (an Albanian UI without an i18n
framework) and [ADR 0008](adr/0008-duplicate-invoices.md) (one supplier invoice is stored once), and in
the MVP schema comments (quantities as 4 dp scaled `BigInt`).

## 12. Decisions taken by default (changeable, but change them explicitly)

| #   | Question        | Default now, in the code                                                                                                                                                                                                                                                                                                                                                                              |
| --- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D2  | Dev Postgres    | `pnpm db:dev` starts a PostgreSQL matching `DATABASE_URL` (host, port, user, database read from `.env`) with a local `pg_ctl`/`initdb` install — cluster in `.devdata/` — or Docker (`postgres:17`), and creates the test database too; it fails loudly when neither is installed rather than silently doing nothing. Nothing is bundled, so a real or hosted server needs only `DATABASE_URL` edited |
| D3  | Deployment      | Vercel (web) + managed Postgres + S3/R2 (storage); the worker gets a container image and runs anywhere                                                                                                                                                                                                                                                                                                |
| D4  | Initial scope   | Phases 0–4 first, then review                                                                                                                                                                                                                                                                                                                                                                         |
| D5  | Fiscal depth    | Generic EN 16931-shaped fields now; Kosovo VAT defaults as seed data; state-specific fiscalisation as adapters                                                                                                                                                                                                                                                                                        |
| D6  | AI provider     | Provider-agnostic interface, Gemini as the default implementation, OpenAI as the second adapter                                                                                                                                                                                                                                                                                                       |
| D7  | Locale/timezone | Single-locale Albanian UI (ADR 0007): copy in `apps/web/src/lib/copy/sq.ts`, dates as `14.03.2026`; money already grouped the market's way (`1.234,56`); per-tenant timezone + currency; no locale switcher until a second market exists                                                                                                                                                              |

Every one of these has a home in an ADR the moment it stops being a default and becomes a constraint.
