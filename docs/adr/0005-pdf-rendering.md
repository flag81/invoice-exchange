# ADR 0005 — PDF rendering with `@react-pdf/renderer`, hashed and immutable

- **Status**: proposed (phase 0), validated by a spike before phase 4
- **Date**: 2026-10-16

## Context

An exchanged invoice needs a legal document: a PDF that (a) looks professional, (b) can be produced
by a background job, (c) is deterministic for a given invoice version so its hash means something,
and (d) does not require a headless browser in production.

Candidates: `@react-pdf/renderer` (React-style layout in pure JS), `pdfkit` (imperative drawing),
`pdf-lib` (generation + manipulation), and HTML→PDF via Playwright/Chromium (best fidelity, worst
operational story).

## Decision

1. Render with `@react-pdf/renderer` in `packages/pdf`, as JSX templates fed by a **plain data
   object** from `packages/shared` — the renderer never touches Prisma, never reads the clock, and
   never performs I/O.
2. The template takes everything as input: locale, timezone, currency, all strings, all amounts, and
   the rendered-at timestamp. Same input ⇒ same bytes, which is the precondition for the stored
   `documentHash`.
3. Fonts are bundled locally (no runtime font fetch), and the standard invoice layout is
   `header → parties → line table → tax summary → totals → payment details → notes`, with a tax
   summary grouped per rate (the KSeF/e-invoicing-friendly shape).
4. Rendered PDFs are written once per `InvoiceVersion` through the `StorageDriver` (ADR 0004) and
   referenced by `InvoiceVersion.pdfBlobId`; regenerating a version is not a supported operation.
   Editing an invoice creates version _n+1_ and a new PDF.
5. **Gate**: a Phase 0/4 spike renders a realistic invoice with non-Latin characters (Albanian
   `ë`/`ç`), a 60-line table with page breaks, and a repeat header/footer, then verifies repeat
   rendering yields identical bytes. If `@react-pdf/renderer` fails that spike, the fallback is
   `pdf-lib` for layout with `pdfkit`-style primitives — the interface in `packages/pdf` is designed
   so the template swap does not touch the rest of the system.

## Consequences

- Rendering runs in the worker with no browser, no system fonts and no network.
- Templates are React components, so they can be unit-tested by snapshotting the document model
  rather than by parsing the PDF.
- Layout expressiveness is lower than HTML/CSS (no complex flexbox edge cases, manual pagination).
  Acceptable for invoices, which are tabular by nature.

## Alternatives rejected

- **Playwright/Chromium HTML→PDF** — hundreds of MB of image, slow cold starts, and non-deterministic
  rendering (font/version drift) that would make the document hash meaningless.
- **`pdfkit`** — workable, but imperative drawing code is harder to review and test than JSX, and it
  is a larger maintenance surface for a template-heavy document.
- **Rendering on the client** — the document must be authoritative and identical for both parties;
  client-generated PDFs cannot be trusted or hashed meaningfully.
