# Security notes

The control-by-control view lives in [`architecture.md` §9](architecture.md#9-security-controls-what-a-reviewer-should-check).
This file is the operational companion: what to do, what to check before shipping, and what to do
when something goes wrong.

## Data classification

| Class            | Examples                                                          | Handling                                                           |
| ---------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| Secret           | DB URL, OAuth client secrets, JWT keys, `ENCRYPTION_KEY`, S3 keys | env only, never in the repo, never in logs, rotated on suspicion   |
| Personal data    | user name/email/IP, contact persons on invoices                   | tenant-scoped, redacted in logs, deletable on request (see below)  |
| Financial record | invoices, lines, payments, credit notes, counterparties           | immutable once issued, append-only audit, retained (see retention) |
| Artifact         | rendered PDFs, buyer attachments, exports                         | private storage, presigned access only, SHA-256 recorded           |

## Key management

- `ENCRYPTION_KEY` (32-byte base64) is used with AES-256-GCM to encrypt provider refresh tokens at
  rest. Rotate with a re-encrypt migration; never reuse a prior key for new data without recording
  the version in the ciphertext envelope (`v1:iv:tag:ciphertext`).
- `AUTH_JWT_PRIVATE_KEY` / `AUTH_JWT_PUBLIC_KEY` are base64 PKCS#8 / SPKI. Rotation: publish the new
  public key in the JWKS, keep signing with the old key until the access-token TTL has passed, then
  swap — no user is logged out.
- Passwords are argon2id (64 MiB, t=3, p=1) with a per-install parameter constant. Changing
  parameters does not invalidate existing hashes; rehash transparently on next successful sign-in.
- Session tokens and refresh tokens are stored only as SHA-256 digests. A database dump does not
  yield a usable session.

## Pre-deploy checklist

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green on the exact commit being deployed.
2. Migrations reviewed by a second person; `prisma migrate deploy` (never `migrate dev`) in the
   release step; `prisma migrate diff --exit-code` reports no drift.
3. Secrets present in the target environment; `.env` is not in the image, and the image has no
   `.git` directory.
4. `AUTH_*` cookie settings are production values (`Secure`, correct `APP_URL`, HTTPS redirect base).
5. Storage bucket is private, versioning on, encryption on; lifecycle rules reviewed.
6. Rate limits enabled for auth routes; alerting wired for `DEAD` outbox rows and 5xx spikes.
7. Database backup taken immediately before the migration; restore procedure verified in the last
   30 days (Phase 5 requires an actual restore drill, not a checkbox).
8. `pnpm audit` reviewed; no unapproved high/critical findings.

## Incident response (first 30 minutes)

1. **Contain**: revoke the affected credential or session family (`Session.revokedAt`,
   `ApiToken` family revocation), disable the OAuth client if the provider is the vector, and rotate
   the secret if it may be in a log.
2. **Preserve**: export the relevant `AuditEvent` slice and access logs filtered by `requestId`
   _before_ any cleanup, and take a database snapshot.
3. **Assess scope**: use the audit trail (it is append-only precisely for this) to determine which
   tenants and which invoices were touched. Do not guess from HTTP logs alone.
4. **Notify**: affected tenant owners per the contractual timeline; for personal-data breaches,
   follow the applicable regulator timeline.
5. **Learn**: add a failing test that reproduces the issue, fix it, and record an ADR if a design
   decision was wrong.

## Retention and deletion

- Issued invoices, versions, credit notes and audit events are legal records: they are retained and
  never hard-deleted.
- A user deletion request removes or anonymises personal data (name, email, IP) while keeping the
  financial record's integrity: historical documents keep the _company_ identity, and the user row is
  anonymised (`deleted_at` set, email replaced with a hash) rather than cascaded away.
- Sessions, OAuth state rows, idempotency keys and rate-limit windows have short TTLs and are swept by
  a job (Phase 7); `RateLimit` and `OAuthState` rows are safe to delete at any time.
