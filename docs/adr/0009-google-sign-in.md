# ADR 0009 — A person signs in with Google, and the session names the company

- **Status**: accepted (phase 3, first slice), implemented in `packages/db` and `apps/web`
- **Date**: 2026-10-17

## Context

ADR 0002 settled the shape of the identity core: an own `User`/`OAuthAccount`/`Session` model, providers
implemented directly over HTTP, sessions as server-side rows. The capture MVP then shipped with the
opposite of that: one seeded company, resolved by `resolveMvpTenant()`, and `docs/mvp.md` named "no
authentication" as its first limitation.

This ADR records what was actually built to close it, and where the implementation deliberately narrows
the original sketch. The narrowing matters more than the agreement: a document that claims bearer
tokens, Facebook and double-submit CSRF while the code has none of them is worse than no document.

## Decision

1. **Google first, and Google only.** `apps/web/src/server/auth/providers/google.ts` is one module over
   the documented endpoints: OIDC discovery (cached), `authorize` URL with PKCE `S256` and a `nonce`,
   token exchange, then an `id_token` verified against the discovered JWKS with `iss`, `aud`, `exp` and
   `nonce` checked. No adapter, no deprecated library, no server-side SDK — ADR 0002's reasoning held.
2. **Identity is the provider's `sub`.** `(provider, providerAccountId)` is the unique key, and it is the
   only thing that identifies a returning person. A provider email links to an existing account **only
   when `email_verified === true`** and only on an exact match after trimming and lower-casing. When the
   provider refuses to assert a verified email, the sign-in is refused with `EMAIL_UNVERIFIED` and
   **nothing is written**: no user, no account row, no membership, no company. A refusal that half-writes
   would leave an orphan tenant behind every failed attempt.
3. **A returning user's profile is not overwritten from the provider.** The email is never rewritten and
   `emailVerifiedAt` is preserved; only a null display name or avatar is filled in. The identity provider
   owns the login, not our record of who the customer is.
4. **The OAuth attempt is a row _and_ a cookie, and both must agree.** `OAuthState` stores `state`,
   `code_verifier`, `nonce` and the validated return path for ten minutes; the HttpOnly `einv_oauth`
   cookie carries the same values. The callback compares the two in constant time, then consumes the row
   with **one conditional `UPDATE … WHERE consumed_at IS NULL AND expires_at > now()`**, so a replayed
   callback finds no row to consume. A missing or mismatched cookie returns before the database is
   touched at all — a forged callback costs nothing.
5. **The return path lives in the row, not in the query string,** and is validated on the way out by
   `safeReturnTo`: a site-relative path, never a scheme, never `//host`. Otherwise `?next=` is an open
   redirect wearing this site's session cookie.
6. **First sign-in provisions a tenant.** If the person has a membership, that company is the session's
   company. Otherwise the oldest member-less company is adopted (so a freshly seeded install and the
   first real sign-in do not end up with two), and if there is none, one is created with Kosovo defaults
   — `XK`, `EUR`, the five VAT rates from `KOSOVO_VAT_RATES` with `vat-18` as the default — and an
   `OWNER` membership. Provisioning is one transaction; a person is never signed in to a company they
   cannot act for.
7. **The session is a row, and the cookie is an opaque handle to it.** 32 random bytes go to the browser
   as `HttpOnly; SameSite=Lax; Path=/` (`Secure` when `APP_URL` is https); only the SHA-256 is stored.
   The row lives 30 days. Every request re-reads the company, the membership and the role from the
   database, so a removed membership or a deleted company ends access immediately instead of at the next
   deploy, and a demotion applies on the next request. `last_seen_at` is refreshed at most once every
   five minutes, and a failed refresh never fails the request it was decorating. Sign-out marks the row
   `revoked_at` rather than deleting it, so "was this token valid at 14:02?" still has an answer.
8. **The company comes from the session, never from the request.** `requireActor(request)` is the only
   way a route learns who is asking and which company they act for; `currentActor()` does the same for a
   server component. `resolveMvpTenant()` is gone. No query takes a company id from a body, a query
   string or a header, which is what keeps ADR 0003's isolation true now that more than one company can
   exist in one database.
9. **CSRF is an origin check, applied before the database.** `assertSameOrigin` refuses a mutating
   request whose `Origin` (or, without one, `Sec-Fetch-Site`) names another site; a request with neither
   header is a non-browser client that cannot be tricked into carrying a cookie. `SameSite=Lax` is the
   belt, this is the brace. The double-submit token from ADR 0002 is **not** implemented for these
   flows: every mutating call is a same-origin `fetch` or form POST, and the OAuth leg is already bound
   to a single-use row.
10. **Failures are codes, not provider prose.** The callback answers `303 /signin?error=CODE`, where the
    code is one of `NOT_CONFIGURED`, `OAUTH_FAILED`, `EMAIL_UNVERIFIED`, `DATABASE_UNAVAILABLE`. A
    `PERMISSION_DENIED` from Google maps to `EMAIL_UNVERIFIED`, a `DatabaseUnavailableError` to
    `DATABASE_UNAVAILABLE`, and anything else to `OAUTH_FAILED` plus a server log with the detail. The
    provider's message never reaches the URL, where it would be reflected into the page.
11. **`/api/ready` stays public.** The caller is a load balancer that cannot hold a cookie; the response
    carries no tenant, no invoice and no credential. Everything company-scoped goes through
    `requireActor`.

## Consequences

- **The capture MVP's first limitation is gone, and nothing downstream had to move.** Every repository
  already took a `companyId`; the change was replacing one function that invented it with one that reads
  it from a session row. The invoices a person captures now belong to the company they signed in for.
- **Two reads are added to every request** — the session by its unique hash, and the tenant behind it —
  plus the membership read that `findActiveSession` already performs. Three indexed lookups on a page
  that makes four API calls is still less work than the correctness is worth: the alternative (a role and
  a company cached in a signed cookie) is exactly how a removed employee keeps writing invoices.
- **The implementation is narrower than ADR 0002's sketch, deliberately.** Three items are not built:
  password login (`User.passwordHash` exists and is unused), Facebook (`providers/` has one module), and
  the mobile bearer-token pair (`AUTH_JWT_PRIVATE_KEY`, `AUTH_ACCESS_TOKEN_TTL_SECONDS` are declared in
  `.env.example` and read by nothing on this path). Each is additive: a second provider implements the
  same interface, and access tokens are a second way to resolve an `Actor`, not a second session model.
  Recorded here so the next phase inherits a decision rather than a surprise.
- **Sessions are not swept.** Expired and revoked rows stay until something deletes them; the OAuth
  attempt table _is_ swept on every create, because it is written on a public endpoint. A session sweep
  belongs to the worker (phase 7) or to a scheduled job, and until then the table grows by one row per
  sign-in — bounded by usage, not by attackers.
- **One company per session.** A person who belongs to two companies signs in to one of them; the
  memberships are already listed by `GET /api/auth/session`, so switching is a `POST /api/auth/switch`
  that rewrites `active_company_id` and re-issues nothing else. Not built, because the MVP has no
  invitation flow that could give anyone a second membership.
- **The tests are honest about what they prove.** The provider is tested against a stubbed `fetch` with
  real JOSE keys, including a `nonce` replay and an `aud` mismatch; the database layer is tested against
  a fake transaction that records what was asked of it; the routes are tested with the session mocked,
  because the session has its own tests. The one thing no unit test proves — a real round trip with
  Google — is checked by hand on the dev server, and is the reason the provider module keeps its
  documented request shapes in one file.

## Alternatives rejected

- **Auth.js / NextAuth** — rejected in ADR 0002 for the same reasons that still apply: its session model
  is user-centric, its adapter owns tables we want to own, and company-scoped sessions are the thing it
  models worst.
- **A hosted identity provider (Firebase, Auth0, Clerk)** — puts a vendor in the path of every sign-in and
  every revocation, charges per user for a market where the customer is an accountant with a laptop, and
  still hands back "a user", leaving company resolution to us anyway.
- **A stateless signed cookie (JWT as the session)** — nothing to revoke. "Sign out everywhere" and
  "remove this person from the company" become impossible without a denylist, which is the session table
  with extra steps.
- **Storing the session token itself** — a database dump or a backup then hands out live sessions. The
  hash costs one function call and loses nothing: the token only ever needs to be compared, not read.
- **`GET /api/auth/oauth/google/start`** — a link prefetch, a crawler or an `<img src>` would start an
  attempt and overwrite the cookie of the person who is actually signing in. It is a POST for that reason.
- **Linking accounts on an unverified email** — the one thing an attacker with a Google account controls
  is the address they signed up with; trusting it unchecked is account takeover by typo, or by intent.
- **Creating a fresh company on every first sign-in, with no adoption rule** — a seeded install and a real
  sign-in then produce two companies, and the demo data silently belongs to nobody.
- **Carrying `returnTo` in the query string** — a URL parameter that ends up in a `Location` header is an
  open redirect with a session attached. It is validated and stored server-side instead.
