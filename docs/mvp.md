# The capture MVP — photograph an invoice, confirm it, store it

**Status:** implemented and green. It is the first _vertical_ slice of the product: it cuts through the
domain core, the database and the web app, and it is deliberately small enough to read in one sitting.

The full plan is in [`architecture.md`](architecture.md). This document is the honest description of
what exists today, how to run it, and exactly where its edges are.

---

## What it does

Everyone signs in first (ADR 0009): `/signin` offers Google, and the session it creates names the person
**and** the company every following request is scoped to. Signing out revokes the row, not just the
cookie.

1. **Capture.** The home screen opens the rear camera: a live `getUserMedia` preview with one shutter,
   drawn to a canvas so the stored bytes are exactly what was framed (ADR 0010). The hidden file input
   behind it keeps `capture="environment"` for the origins where `getUserMedia` does not exist at all (a
   phone on a plain-http LAN address, where it opens the native camera app), and a second control takes a
   file: a photo from the gallery, or a PDF a supplier emailed. Nothing else is asked for: no supplier
   picker, no form.
2. **Upload.** `POST /api/documents` sniffs the **bytes** (JPEG, PNG, WebP, HEIC/HEIF, or a PDF by its
   `%PDF-` header), enforces a byte ceiling, generates the storage key, writes the bytes, and inserts the
   `document_blobs` row that makes them owned (ADR 0004). The client's `Content-Type` is stored for
   nothing and trusted for nothing, and the row's `kind` records whether the bytes are a photo or a PDF.
3. **Read.** `POST /api/extractions` loads the bytes by key (tenant-scoped), sends them to the configured
   provider, and normalises the answer with `@einv/shared`: exact minor units, the tenant's own tax-rate
   rows, dates as calendar days — plus a list of **every** thing the reader had to assume. The response
   names the provider and model that produced the draft, and the review screen shows it: a provider that
   did not read the document must never look like one that did. A PDF is sent as a PDF — the model reads
   its pages, including a multi-page invoice whose totals sit on the last one.
4. **Review.** The screen shows the extracted fields as editable text, separates `error` (blocks saving)
   from `warning` (does not), and shows the totals as they will be stored — recomputed live in the
   browser by the same `computeTotals` the server will run.
5. **Save.** `POST /api/invoices` re-parses the reviewed text, recomputes everything, refuses the draft if
   any error remains, checks the §4.4 identities, refuses an invoice whose supplier and number are
   already stored (ADR 0008), and writes the invoice and its lines in one transaction, linking the
   extraction it came from. The review screen asks the same question before the button is pressed
   (`GET /api/invoices/duplicate`) and shows the way to the invoice that already exists.
6. **Look.** `/invoices` lists what was captured (newest first, money formatted by string, never `Intl`),
   and `/invoices/[id]` shows the stored document, its VAT summary, and whether the stored totals still
   agree with its lines.

The interface is Albanian (ADR 0007): one locale, every string in `apps/web/src/lib/copy/sq.ts`, dates
printed the way this market reads them (`14.03.2026`). The extraction's own warnings and errors are
Albanian too, because they quote the amounts and quantities they are about — and those are built in
`@einv/shared`, next to the numbers.

## What it deliberately does not do

No invitations and no second provider: a person signs in with Google and lands in the company of their
membership (ADR 0009), but nothing yet lets an owner invite a colleague, lets one person belong to two
companies without signing in twice, or gives an accountant without a Google account a way in. No issuing,
numbering or PDF _rendering_ — a supplier's PDF can be captured as input, but this build never produces
one. No sending, accepting or paying. No credit notes. No counterparty table: a supplier is the snapshot
on the invoice, and a duplicate is refused by comparing that snapshot and the printed number (ADR 0008).
No torch, no auto-crop or deskew and no multi-page scan: the camera takes one still of one page, and
anything it cannot frame is photographed twice. No worker process and no queue. Each of those has a
phase and a reason in `architecture.md` §11; none of
them is needed to answer the question this slice exists to answer — _can a phone photograph become an
exact, reviewable, stored invoice?_

## Running it

PostgreSQL is the one prerequisite (the same one the full product has):

```bash
pnpm install
cp .env.example .env          # DATABASE_URL is the only value you need to fill in
pnpm db:dev                   # start Postgres (pg_ctl cluster in .devdata/, or Docker)
pnpm db:migrate               # create the tables
pnpm db:seed                  # the demo company + the Kosovo VAT rates (18 %, 8 %, zero, exempt, RC)
pnpm dev                      # http://localhost:3001
```

Open <http://localhost:3001>: the camera button is the product, and it works on a desktop browser as
well as on a phone, because it is a real `getUserMedia` preview rather than a `capture` hint (ADR 0010).

Two constraints are the browser's, not the app's, and both are worth knowing before a demo:

- **`getUserMedia` needs a secure context.** `http://localhost` counts as one; a LAN address does not, so
  <http://192.168.x.x:3001> on a phone has no camera. That origin falls back to the file input, whose
  `capture` attribute opens the native camera app instead. Use `pnpm dev:https` to photograph with a
  phone against your dev machine.
- **The permission is answered once per origin.** A refusal is remembered by the browser, and a
  remembered refusal never prompts again — so the overlay says which of the two it is, names the
  reason, and offers the file input rather than pretending the camera is broken. Where no prompt is
  possible at all (a plain-http origin, or a policy that forbids the camera), the card says so _before_
  the button is pressed, instead of silently handing over a file dialog.

**Extraction needs no AI key to run.** With no `AI_PROVIDER` and no `GEMINI_API_KEY`, the app uses the
`stub` provider, which derives a deterministic, internally consistent invoice from the image's own bytes
— so the whole pipeline (upload → extract → review → save) is exercisable offline. To read real invoices,
put a key in `GEMINI_API_KEY` (or set `AI_PROVIDER="gemini"`, which _fails loudly_ if the key is missing
rather than silently falling back to the stub).

If the database is not reachable, the app does not pretend: it renders the three commands above instead
of a camera button that would fail on every press.

## Where the code lives

```
apps/web/src/
  app/page.tsx                     capture screen (server component + readiness check)
  app/invoices/…                   list and detail, read straight from @einv/db
  app/api/documents/route.ts       POST  upload: sniff, cap, store, index
  app/api/extractions/route.ts     POST  read the stored document (photo or PDF), normalise, record the attempt
  app/api/invoices/route.ts        GET   list · POST save the reviewed draft
  app/api/invoices/duplicate/route.ts  GET  is this supplier + number already stored? (ADR 0008)
  app/api/invoices/[id]/route.ts   GET   one invoice, tenant-scoped
  components/                      CaptureFlow (state), CaptureCard, ReviewPanel, ReviewLinesCard
  lib/invoice-view.ts              client-safe view types + the live preview arithmetic
  server/storage/local-storage.ts  keys, path safety, SHA-256, put/get (ADR 0004's `local` driver)
  server/extraction/               the provider contract, Gemini, the stub, the prompt
  server/invoices/draft-view.ts    domain draft → the strings a form holds
  server/http.ts                   the error envelope: domain rule → 4xx, no database → 503

packages/shared/src/extraction/    the normaliser: raw provider answer → draft + problems
packages/shared/src/documents/     the upload policy (magic bytes, size grammar)
packages/shared/src/invoicing/     status, transitions, invariants, and duplicates (what is the same paper)
packages/db/                       schema + migration, repositories, the pure row ⇄ domain mappers
```

One request, end to end:

```
phone camera ──▶ POST /api/documents
                  inspectUpload(bytes)              ← type from the magic number
                  putObject(key) + recordDocument   ← bytes in storage, row in the database
              ◀── documentId
              ──▶ POST /api/extractions
                  findDocumentById(companyId, id)   ← tenant-scoped, key never from the client
                  provider.extract(bytes)
                  normaliseExtractedInvoice(raw, { currency, taxRates })   ← bigints + problems
                  recordExtraction(raw + draft)     ← kept, even when it fails
              ◀── draft (strings) + tax rates
              ──▶ POST /api/invoices
                  normaliseInvoiceSubmission(text)  ← re-parsed, never trusted
                  assertSavable · assertTotalsConsistent
                  findDuplicateInvoice(supplier, number)  ← 409 if the tenant already has it
                  invoice.create({ …, lines: { create: […] } })
              ◀── invoice
```

## The rules this slice already keeps

Each of these has a test behind it, not just a paragraph:

- **Money is an integer count of minor units.** No `number` ever holds an amount (ADR 0006).
- **One rounding rule**, per line, before summing (`scaled.divRoundHalfUp`), so the stored totals are the
  sum of the amounts on the rows.
- **Nothing is invented.** A field the reader missed becomes a `problem`, never a plausible default; an
  unreadable price is an `error` on the line, and the save endpoint refuses a draft that still has one.
- **The model's arithmetic is ignored.** Printed totals are compared with the computed ones and a
  disagreement is reported (`PRINTED_LINE_TOTAL_MISMATCH`, `PRINTED_TOTAL_MISMATCH`) — the numbers stored
  are always ours.
- **A rate is data, not a constant.** A printed percentage is matched against the tenant's `TaxRate` rows;
  when nothing matches, the fallback is used _and reported_ (`TAX_RATE_ASSUMED`).
- **The client is never believed.** The browser posts text; the server re-parses it, recomputes the totals
  and would refuse the same draft a second time. A posted `unitPriceMinor` is ignored entirely.
- **One paper is stored once.** A capture is refused when the same supplier's printed number is already
  stored — the supplier's VAT digits (or its punctuation-free name) plus the normalised number, compared
  by `@einv/shared` — so a photo and the supplier's PDF of one invoice cannot both become invoices
  (ADR 0008).
- **Uploads are decided by their bytes**, capped by the server, stored under server-generated keys
  (`companyId/yyyy/mm/uuid.ext`) behind a path check that refuses traversal.
- **The camera is a preview, not a hint.** The capture button opens `getUserMedia` and stores the frame it
  drew, rather than relying on `capture="environment"`, which desktop browsers, Firefox and Chrome's device
  emulation all ignore. Where there is no `getUserMedia` the fallback is the file input — never a button
  that does nothing (ADR 0010).
- **Everything is tenant-scoped.** No query takes a company id from the request, and another tenant's
  document or invoice reads as "not found".
- **Failures are recorded.** A failed extraction is stored with its error message, and the raw model answer
  is kept next to the draft it produced, so "why is this number wrong?" is answerable months later.

## Known limitations (in the order they will bite)

1. **One provider, one company per session.** Sign-in is Google only; `User.passwordHash` and the
   Facebook module are still unused, the mobile bearer-token pair is unbuilt, and a person who belongs to
   two companies cannot switch between them yet (ADR 0009). Everything else already assumes a session —
   `resolveMvpTenant()` is gone and no query takes a company id from the request.
2. **Only the `local` storage driver is implemented.** `STORAGE_DRIVER=s3` is refused loudly rather than
   writing to a container's ephemeral disk.
3. **`DRAFT` only.** No issuing, numbering, locking or versioning yet, so `lockedAt` is always null and the
   §4.3 invariants are enforced by the repository rather than by a transition.
4. **Duplicate detection is a check, not yet a constraint.** Two saves racing each other can both pass
   it; closing that needs a normalised `duplicate_key` column with a unique index (ADR 0008). There is
   also no override for the one legitimate case — a corrected re-issue carrying the same number — because
   invoice versioning does not exist yet.
5. **The UI has no browser tests yet.** Routes, mappers and the preview arithmetic are covered (below); the
   end-to-end journey (Playwright) is phase-3 work.
6. **Extraction quality is the provider's.** The pipeline guarantees that a bad reading becomes a visible
   problem; it cannot guarantee a good reading. Budget caps and a review queue arrive with the worker.
7. **No key means the stub, and the stub invents the invoice.** With `GEMINI_API_KEY` unset the pipeline
   runs end to end on a deterministic fixture built from the file's hash — useful for tests and demos, and
   useless as a reading. The review screen says so in a warning card and `/api/ready` reports
   `extraction: warn`; any number saved from that screen is an example, not the document.

## How it is verified

| Suite             | Tests               | Coverage (gate)                         |
| ----------------- | ------------------- | --------------------------------------- |
| `packages/shared` | 298 across 25 files | lines 99.1 %, branches 95.9 % (95 / 90) |
| `packages/db`     | 73 across 7 files   | lines 99.2 %, branches 85.2 % (80 / 75) |
| `apps/web`        | 297 across 32 files | lines 95.4 %, branches 86.6 % (80 / 75) |

`pnpm lint` (boundary rules included), `pnpm typecheck` and `pnpm format:check` are clean, and the schema
is validated by `prisma validate` with the migration generated from it.

The suites that need a real database (repositories against PostgreSQL) belong to the phase-2 integration
harness and are not in these numbers — which is why the repository layer is excluded from the unit-coverage
denominators while the _mappers_ (where the arithmetic and the tenant scoping live) are covered exhaustively.

## What comes next

In order of value per unit of work:

1. **Phase 3 (auth), the rest of it** — invitations and company switching, password login for accountants
   without a Google account, and the mobile bearer-token pair. The first slice — Google sign-in, sessions,
   `requireActor` — is done and recorded in ADR 0009; `resolveMvpTenant()` became "the company of the
   signed-in membership" without any repository changing.
2. **Integration suite** — Postgres in CI, tenant-isolation and concurrent-numbering tests against the real
   tables, plus the E2E capture journey.
3. **Phase 4 (exchange)** — issue, number, lock, render a PDF, send, accept, pay: the states the domain core
   already models (`invoicing/transitions.ts`, `exchange/transitions.ts`).
4. **Phase 7 (worker)** — move extraction out of the request, add reminders and the human review queue, with
   budget caps.
