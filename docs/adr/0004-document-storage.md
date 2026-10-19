# ADR 0004 — Private object storage, presigned access only, local driver in dev

- **Status**: accepted (phase 0), implemented in phase 4
- **Date**: 2026-10-16

## Context

The platform stores rendered invoice PDFs, buyer-uploaded attachments (purchase orders, delivery
notes, dispute evidence) and generated exports. These are financial documents about other companies:
a public URL is a leak, and storing them in the database bloats backups and makes streaming awkward.

## Decision

1. Binaries live in **private S3-compatible object storage** (S3, Cloudflare R2, MinIO) behind a
   `StorageDriver` interface with exactly four operations: `put`, `get`, `delete`, `presign`.
2. Two drivers ship from day one: `s3` (production) and `local` (filesystem, for dev, CI and tests).
   Choosing is a single env var (`STORAGE_DRIVER`), so tests never need a bucket.
3. Buckets/objects are never public. Clients receive **presigned URLs only**: 60-second GET for
   preview/download, PUT URLs bound to a content type and a maximum size for buyer uploads.
4. Object keys are `companyId/yyyy/mm/{uuid}` — tenant-namespaced, unguessable, and meaningless
   without a valid signature.
5. Every stored artifact has a `DocumentBlob` row (owner, kind, mime, size, SHA-256, creator). The
   database is the index; a file with no row is garbage, and a row whose file is missing is an
   incident (the health check reports both).
6. Access checks happen **before** signing: the download route resolves the document within the
   tenant scope, verifies permission, then returns a `302` to the signed URL. Uploads are validated
   by MIME sniffing on the stored bytes, not on the client-declared type.

## Consequences

- No document bytes travel through the Next.js runtime (important for a serverless deploy); the app
  only signs URLs.
- A leaked URL expires in a minute and cannot be replayed by anyone else afterwards.
- Local development needs no cloud credentials; the local driver writes to `.devdata/storage`.
- Trade-off: a failed upload can leave an orphan object (no `DocumentBlob` row). A periodic sweep job
  in Phase 7 reconciles bucket contents against the table.

## Alternatives rejected

- **Blobs in Postgres (bytea)** — bloats backups, complicates streaming, no CDN path.
- **Public bucket + unguessable keys** — unguessable is not a permission model.
- **Signed URLs as the API contract** (client uploads directly, no proxy) — rejected as the only
  path because it forfeits server-side MIME/size validation; used only for large buyer uploads, with
  the size/type constraints enforced in the signature and re-verified on read.

## Amendment — 2026-10-17: a PDF is a capture input, not a conversion job

Decision 6 fixed _how_ a type is decided (sniffed bytes) but said nothing about _which_ types the
capture screen takes. It now takes a sixth: `application/pdf`, recognised by the `%PDF-` header at
offset 0. Everything else about the upload path is unchanged — same ceiling, same server-generated
key, same `DocumentBlob` row — and the row's `kind` distinguishes `SOURCE_PDF` from `SOURCE_IMAGE`,
so "what did the supplier actually send?" is answerable without opening the file.

Why store it instead of rasterising it first:

- No PDF renderer is added to the server. A renderer is a large native dependency (Ghostscript,
  MuPDF, headless Chromium) and a well-known target for hostile input; the extraction provider reads
  the PDF natively, so the bytes only ever pass through as opaque data.
- The text layer survives. A rasterised PDF loses selectable text, which is exactly what makes an
  emailed invoice cheaper to read correctly than a photograph of the same page.
- The stored artifact is what the supplier sent, byte for byte, which is what an audit needs.

Consequences, stated because they are not free:

- **A PDF is active content.** It can carry JavaScript, form actions and embedded files. This service
  never renders, parses or executes one, and phase 4's download route must serve it as
  `Content-Disposition: attachment` with `X-Content-Type-Options: nosniff` (a sandboxed viewer if it
  ever previews inline) rather than handing it to a document viewer on our origin.
- **Multi-page is the model's job.** The prompt tells the provider to read every page and treat them
  as one document; there is no page splitting or per-page extraction, and no page count is recorded.
  A model that reads only page one would return a plausible, incomplete invoice — the review screen
  is the guard, as it is for a bad photograph.
- **The size ceiling is shared.** `STORAGE_MAX_UPLOAD_BYTES` (8 MiB by default) applies to both kinds.
  Raising it is bounded by the provider: an inline Gemini request caps at 20 MB, and base64 inflates
  bytes by ~4/3, so the practical ceiling is about 14 MB of raw file.
