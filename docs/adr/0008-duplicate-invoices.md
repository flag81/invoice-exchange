# ADR 0008 — The same supplier invoice is stored once

- **Status**: accepted (capture MVP), implemented in `packages/shared`, `packages/db` and `apps/web`
- **Date**: 2026-10-17

## Context

The capture flow is a phone pointed at paper, and the same paper arrives more than once: a photograph
today and the supplier's PDF by email tomorrow; the same photo uploaded again after a dropped
connection; two people in the same office capturing the same envelope. Every one of those captures
looks correct on the review screen, because it is — it is simply the second copy of an invoice the
company already has. `docs/mvp.md` listed this as a known limitation and put the fix behind "the
counterparty table from phase 4".

That dependency turned out to be the wrong way round. What identifies an invoice to a human is already
stored on the row: **the supplier and the number printed on the paper** (`supplier_name`,
`supplier_vat_number`, `invoice_number`), captured as a snapshot precisely so that reading an old
invoice never depends on a supplier record that has since been renamed. A counterparty table is needed
to _link_ invoices to one supplier; it is not needed to notice that this number is taken.

## Decision

1. **Identity is the supplier's printed number, not the file.** `@einv/shared/src/invoicing/duplicates.ts`
   is the single definition: the number is normalised (trim, collapse whitespace, fold case) and the
   supplier is its VAT number as digits when one is present (`811 234 567`, `XK811234567` and
   `811.234.567` are one taxpayer), falling back to the name with punctuation, spacing and case removed
   (`NPT Kafe Sh.p.k.` = `NPT Kafe SHPK`). No number means no claim, so an invoice whose number the
   reader could not find is never accused of being a duplicate.
2. **The server refuses the write.** `saveCapturedInvoice` checks the tenant's own history before the
   insert and throws `DUPLICATE_INVOICE`, which the HTTP layer maps to **409** with the existing invoice
   in `error.details` (`id`, `invoiceNumber`, `supplierName`, `issueDate`, `totalMinor`, `currency`).
   The row is not created, the lines are not created and the extraction is not re-linked.
3. **The review screen asks first.** `GET /api/invoices/duplicate?…` runs the same repository query,
   debounced while the person types, and the review screen shows a blocking card naming the invoice that
   already exists with a link to it. The disabled save button is a courtesy; the 409 is the control.
4. **The oldest match wins.** The person is sent to the original capture, not to the most recent copy of
   it, so following the link does not lead to another duplicate.
5. **No silent skip and no overwrite.** The save fails loudly. Quietly dropping a capture would leave
   someone believing the invoice was stored, and overwriting the existing row would discard the first
   capture's extraction link and review history.
6. **No override in the MVP.** A duplicate is a fact about the paper, not a warning to click through.
   If two genuinely different invoices ever share a supplier and a number, one of those numbers is
   ambiguous and the fix belongs upstream (the supplier's numbering), not in a checkbox.

## Consequences

- `docs/mvp.md`'s "no duplicate detection" limitation is gone, without a counterparty table: the check
  reads the snapshot the invoice already carries, so it works for a supplier the company has never
  stored separately.
- The check and the save each read the tenant's numbered invoices (`invoice_number IS NOT NULL`, scoped
  by `companyId`) and compare them in the domain, so there is one definition of "duplicate" rather than
  a SQL approximation. At capture-MVP volume (one tenant, hundreds of invoices) that is a single small
  read; when it is not, the next step is a normalised `duplicate_key` column with a unique index.
- **The rule is not yet race-proof.** Two saves that pass the check at the same instant can both insert;
  a unique index is what closes that, and it needs the key column above plus a backfill of existing
  rows. This is named here rather than pretended away: in a single-tenant MVP the realistic mistake is
  sequential, and the check catches it.
- False negatives remain possible where the reader mangles a number (`O` versus `0`, a lost digit): a
  missed duplicate is an annoyance, and the list screen still shows both. False positives require the
  same VAT number (or the same punctuation-free name) _and_ the same number, which is the definition of
  the same document.
- The identity function is the thing to reuse when phase 4 adds a duplicate review queue or a merge:
  the question "is this the same invoice?" is answered in one place.

## Alternatives rejected

- **A unique index now** — it cannot be added without a stored normalised key and a backfill, and it
  blocks the one legitimate future case (a corrected re-issue carrying the same number) behind a
  versioning model that does not exist yet. The check is enforced in the repository today; the index
  arrives with the column.
- **Hashing the uploaded file** — the common duplicate is a photo _and_ a PDF of one invoice, whose
  bytes differ, so identity would depend on how the document arrived rather than on what it says.
- **Checking in the browser only** — a disabled button is a courtesy, not a control; the rule has to be
  enforced by the layer that can still see the whole tenant.
- **Comparing totals or line items** — a corrected invoice keeps its number and changes the amounts;
  matching on amounts would miss it and match unrelated invoices that happen to add up the same.
- **A `LIKE` / case-insensitive SQL equality on `invoice_number` alone** — misses the same number typed
  with different spacing, and matches the same number across different suppliers.
