# ADR 0002 — Own identity core; OAuth providers hand-rolled on `fetch` + `jose`

- **Status**: accepted (phase 0), implemented in phase 3
- **Date**: 2026-10-16

## Context

Requirements: email/password **and** Google **and** Facebook sign-in, multi-tenant memberships, a
mobile app that needs bearer tokens, and a session model we can audit and revoke.

The original plan was `arctic` for the OAuth leg. Checking the registry at bootstrap time:
**`arctic` is deprecated**, so building new code on it would add a dependency that is already
unsupported. NextAuth/Auth.js was the other candidate, but it fights multi-tenant sessions and its
model of "a user belongs to a provider" does not match "a user belongs to companies", and its mobile
story is bearer tokens bolted on afterwards.

## Decision

Own the identity core, and implement the two providers directly against their documented HTTP APIs.

1. `User` holds an optional `passwordHash` (argon2id) plus zero or more `OAuthAccount` rows. An
   account can have both a password and one or more providers.
2. Provider code lives behind a small `OAuthProvider` interface in
   `apps/web/src/server/auth/providers/`, implemented with global `fetch` and `jose`:
   - Google: OIDC discovery, PKCE (`S256`), `nonce`, RS256 `id_token` verification against the JWKS
     with `iss`/`aud`/`exp`/`nonce` checks; email trusted only when `email_verified === true`.
   - Facebook: OAuth dialog + Graph token exchange, then `/me?fields=id,name,email` with
     `appsecret_proof`; email treated as unverified.
3. `state`, `code_verifier` and (for Google) `nonce` are stored in a single-use `OAuthState` row
   **and** mirrored in a short-lived HttpOnly cookie; the callback requires both to match and then
   deletes the row (10-minute TTL).
4. Automatic account linking happens only on an exact match of a **verified** provider email.
   Anything else creates a new identity and requires an explicit, authenticated link.
5. Sessions are server-side rows with only the SHA-256 of a 256-bit random token stored. Mobile/
   integration clients get 15-minute RS256 access tokens plus rotating opaque refresh tokens with
   family-revocation on reuse.
6. CSRF protection is a double-submit cookie plus an Origin check — never `SameSite` alone.

## Consequences

- Two small files of OAuth code to own, no deprecated dependency, no adapter that hides what is sent
  to the provider. The flows are testable with a stubbed provider (E2E does exactly that).
- We are responsible for following provider API changes; the surface is tiny (authorize URL, token
  endpoint, one userinfo call).
- `openid-client` / `@badgateway/oauth2-client` remain viable if the surface grows (e.g. more
  providers, token introspection); swapping them in means implementing the same interface.

## Alternatives rejected

- **`arctic`** — deprecated; not acceptable for new code.
- **NextAuth / Auth.js** — opinionated session and adapter model, awkward for company-scoped
  sessions and bearer tokens.
- **`passport`** — Express middleware shape, no fit for route handlers.
- **Provider-only login (no local password)** — the product must work for accountants and partner
  integrations without a Google or Facebook account.
