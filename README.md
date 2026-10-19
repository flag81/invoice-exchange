# e-Invoice Exchange

A web-first, B2B digital **invoice exchange**: a buyer and a supplier who are _both_ registered on the
platform exchange tax-compliant invoices with a status machine, an append-only audit trail, a
versioned legal document, and a record of what happened to it after it was sent.

This repository is a `pnpm` monorepo:

```
invoice-exchange/
  apps/
    web/            Next.js 16 (App Router, RSC, route handlers) — UI + HTTP API
    worker/         (phase 7) background jobs: outbox, mail, PDF rendering, AI extraction
  packages/
    shared/         pure domain: money, totals, tax, status machines, permissions, formats
    db/             Prisma schema, migrations, tenant-scoped client, repositories
    api-client/     fetch-only typed client (also used by the future React Native app)
    pdf/            invoice document renderer (deterministic, no network access)
  docs/
    architecture.md, security.md, adr/
```

**Read [`docs/architecture.md`](docs/architecture.md) first.** It contains the layering rules, the
tenancy pipeline, the invoice exchange model and the phased delivery plan. The most important
cross-cutting decisions are recorded in [`docs/adr/`](docs/adr).

**Working _now_: the capture slice** — photograph (or upload a PDF of) a supplier invoice, have it read, review every
number, and store exact totals. The camera is a real in-app `getUserMedia` preview, so it works on a laptop and on a
phone alike (ADR 0010). See [`docs/mvp.md`](docs/mvp.md) for what it does, how to run it, and the limitations it
knowingly has.

**Reading a document needs an AI key.** With `GEMINI_API_KEY` set in `.env`, photos and PDFs are read by Gemini (a
multi-page PDF is read whole, not page by page). With no key the `stub` provider keeps the pipeline runnable, but it
opens nothing: it returns a deterministic demo invoice. That is never silent — the review screen shows a warning card
and `/api/ready` reports the reader — but its numbers are an example, not the paper in front of you.

## Requirements

| Tool       | Version            | Notes                                               |
| ---------- | ------------------ | --------------------------------------------------- |
| Node.js    | >= 22 (see .nvmrc) | developed on 22.16.0                                |
| pnpm       | >= 9               | `npm i -g pnpm@9`                                   |
| PostgreSQL | >= 15              | or Docker — `pnpm db:dev` starts a local dev server |

## Quickstart

```bash
pnpm install
cp .env.example .env          # then fill in the blanks (only DATABASE_URL is required to boot)
pnpm db:dev                   # start Postgres: pg_ctl cluster in .devdata/, or Docker
pnpm db:generate              # prisma client
pnpm db:migrate               # apply migrations
pnpm db:seed                  # demo tenant + users
pnpm dev                      # http://localhost:3001
```

Facebook login requires the app to be reachable over `https` during development (Facebook rejects
`http://` redirect URIs); Google accepts `http://localhost`, so plain `pnpm dev` is enough for it. For
Facebook, `pnpm dev:https` serves the same port with a TLS certificate — it needs mkcert's CA in the OS
trust store, and if that install is declined Next silently falls back to http, in which case `APP_URL` and
`OAUTH_REDIRECT_BASE_URL` must stay http or the CSRF gate will refuse every write.

`pnpm dev:https` is also how you photograph with a phone against your dev machine: `getUserMedia` needs a
secure context, and `http://localhost` is one while a LAN address is not (ADR 0010). On `http://localhost` —
and on any desktop browser — the camera works with plain `pnpm dev`.

### Google sign-in

`/signin` is the way in (ADR 0009). Create an OAuth client of type **Web application** in the Google Cloud
console, add `<OAUTH_REDIRECT_BASE_URL>/api/auth/oauth/google/callback` as an authorised redirect URI, and
put the pair in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. With either one missing the app
still boots: `/signin` says sign-in is not configured, and every capture route answers 401.

The redirect URI is built from `OAUTH_REDIRECT_BASE_URL` and falls back to `APP_URL`, because Google
compares it literally — a tunnel or a `dev:https` run changes the address without changing what the app
thinks its own origin is. The session cookie is `AUTH_SESSION_COOKIE_NAME` (default `einv_session`):
`HttpOnly`, `SameSite=Lax`, `Secure` whenever `APP_URL` is https.

### PostgreSQL without an installer (Windows)

`pnpm db:dev` only needs `pg_ctl`, `initdb` and `psql` on `PATH`, so no service or administrator
rights are required: unpack EDB's `postgresql-17.x-windows-x64-binaries.zip` anywhere (for example
`%LOCALAPPDATA%\Programs\pgsql`) and add its `bin\` to `PATH`. The script then owns a throwaway
cluster in `.devdata/pgdata` on the port from `DATABASE_URL`, and `pnpm db:dev:stop` ends it. Docker
is only a fallback — it is tried when no local `pg_ctl` exists.

## Root scripts

| Script                         | What it does                                             |
| ------------------------------ | -------------------------------------------------------- |
| `pnpm dev`                     | web app in dev mode on port 3001                         |
| `pnpm dev:https`               | same, over TLS (Facebook login; the camera from a phone) |
| `pnpm build`                   | production build of every app (turbo)                    |
| `pnpm lint` / `pnpm lint:fix`  | ESLint across the workspace, including boundary rules    |
| `pnpm typecheck`               | `tsc --noEmit` in every package                          |
| `pnpm test`                    | Vitest across the workspace                              |
| `pnpm test:coverage`           | same with coverage (gates configured per package)        |
| `pnpm format` / `format:check` | Prettier                                                 |
| `pnpm db:generate`             | `prisma generate`                                        |
| `pnpm db:migrate`              | create + apply a dev migration                           |
| `pnpm db:deploy`               | apply migrations in CI/production (never generates)      |
| `pnpm db:seed`                 | idempotent demo data                                     |
| `pnpm db:studio`               | Prisma Studio                                            |
| `pnpm db:dev`                  | start the dev Postgres (pg_ctl cluster or Docker)        |
| `pnpm db:dev:stop`             | stop it (data is kept)                                   |
| `pnpm db:dev:status`           | report the provider and whether the port is listening    |
| `pnpm clean`                   | remove build output, caches and `node_modules`           |

> **Keep the dev server's output outside the repository.** `next dev` watches the project tree, and a log
> file written inside it (`pnpm dev > dev-server.log`) changes on _every_ request: the watcher recompiles,
> HMR reloads the page, the reload writes the log again — a browser that refreshes forever. Redirect the
> output somewhere outside the repo, e.g. `pnpm dev > "$env:TEMP/einv-dev/dev.log"` on Windows.

## Conventions that are enforced, not suggested

- **Boundaries are lint errors.** `packages/shared` cannot import React, Next, Prisma, Node
  built-ins or `zod`; `packages/api-client` cannot import server code; client components cannot
  import `@/server/*`. See `eslint.config.mjs`.
- **Tenancy is explicit.** Every repository call takes a `TenancyContext` as its first argument and
  the Prisma client filters by the acting company. There is no "global" query helper.
- **The acting company comes from the session.** `requireActor(request)` (or `currentActor()` in a page)
  is the only way a route learns who is asking; no company id is ever read from a body, a query string or
  a header. Mutating requests pass an origin check before they touch the database.
- **Money is integers.** Amounts are stored in minor units (`BigInt`) and all arithmetic goes
  through `packages/shared/src/money.ts`. Floats never touch an invoice total.
- **Numbers are allocated, not guessed.** Invoice numbers come from an atomic per-tenant sequence
  inside the transaction that writes the invoice; uniqueness is also a database constraint.
- **Writes are idempotent.** Mutating HTTP endpoints accept `Idempotency-Key`; the unique index on
  `(companyId, key)` is what actually guarantees it.
- **The audit log is append-only.** No update or delete path exists in the application for
  `AuditEvent`, `InvoiceVersion` or `InvoiceExchange`.
- **No `enum` in TypeScript**, no `any`, no non-null assertions (`eslint.config.mjs`).

## Status

Phase 0 (workspace skeleton) is complete; phases are listed at the end of
[`docs/architecture.md`](docs/architecture.md).
