# ADR 0001 — One repository, pnpm workspaces, packages consumed as source

- **Status**: accepted (phase 0)
- **Date**: 2026-10-16

## Context

The product has one web app today, a background worker next, and a mobile app after that. All three
share a domain that must behave identically (money, tax, invoice lifecycle, the exchange state
machine). Splitting into several repositories would mean publishing and versioning the domain before
it has even stabilised, and would make "did the app and the worker agree on the totals?" a question
that requires cross-repo archaeology.

## Decision

A single repository with pnpm workspaces (`apps/*`, `packages/*`) and Turborepo for task running.

1. `packages/shared` is dependency-free, framework-free domain code.
2. `packages/db`, `packages/pdf`, `packages/api-client` depend only on `shared` (and one runtime
   library each).
3. Workspace packages are **consumed as TypeScript source**: their `exports` fields point at
   `src/index.ts`, `next.config.ts` lists them in `transpilePackages`, and there is no `dist/`
   directory in development.
4. Cross-package boundaries are enforced by ESLint `no-restricted-imports` rules, not by convention.

## Consequences

- Renaming a domain function is one commit and the compiler finds every caller.
- No build/`tsc --watch` orchestration to get a working dev loop; the "stale dist" class of bug
  simply does not exist here.
- The cost: consumers must be able to compile TypeScript from `node_modules` (Next and Vitest can;
  a plain Node process needs `tsx` or an explicit `build` script — that is why `apps/worker` will get
  its own build step when it lands).
- A future npm publish of `api-client` will require adding a real build for that package only.

## Alternatives rejected

- **Separate repos per app/package** — premature versioning, painful shared refactors.
- **Nx** — more configuration surface than this repo needs; turbo's task graph is enough.
- **Pre-built packages with `dist/`** — reintroduces watch/build choreography for no benefit at this
  size.
