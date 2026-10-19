/**
 * The invoice repository — the only place an invoice is written or read.
 *
 * Three properties this module is responsible for, none of which a database can check for us:
 *
 *   1. **Only a savable draft is stored.** `assertSavable` runs before the insert, so a draft that
 *      still has an *error* problem (a missing price, an unreadable date) cannot reach the table by
 *      way of a hand-made HTTP request.
 *   2. **The totals are checked, not trusted.** `assertTotalsConsistent` re-derives the identities of
 *      §4.4 from the lines; the row is the reviewed snapshot, but a snapshot that does not add up is a
 *      bug and fails here rather than in a tax report.
 *   3. **Everything is tenant-scoped.** `companyId` is part of every `where`, and the write path never
 *      takes an id from the caller.
 *   4. **The same paper is stored once.** `findDuplicateInvoice` compares the supplier and the printed
 *      number against the tenant's own history before the insert, and the write is refused with
 *      `DUPLICATE_INVOICE` rather than silently creating a second copy of one invoice (ADR 0008).
 *   5. **The list's search is one query.** `listInvoices` matches the same text against the supplier's
 *      name *or* a line's description, so nobody has to know whether the paper said "Kafe" in the
 *      header or on row 3 to find it — and it stays inside the tenant's rows like every other read.
 *
 * The invoice and its lines are written in one transaction: a header without lines would be a document
 * that claims a total it cannot justify.
 */

import {
  assertTotalsConsistent,
  DomainError,
  DomainErrorCode,
  findDuplicate,
  invoiceIdentity,
  type NormalisedDraft,
} from '@einv/shared';

import { withDatabase } from '../client';
import { assertSavable, type Tenant } from '../tenancy';
import { toInvoiceCreateData, type CaptureSource } from './mappers';
import {
  toInvoiceSummaryView,
  toInvoiceView,
  type InvoiceRow,
  type InvoiceSummaryView,
  type InvoiceView,
} from './view';

export type FindDuplicateInvoiceInput = {
  readonly companyId: string;
  /** The number as it is about to be stored (or as the review screen currently holds it). */
  readonly invoiceNumber: string | null;
  readonly supplierVatNumber: string | null;
  readonly supplierName: string | null;
};

/**
 * The invoice already stored for this supplier and number, or `null` when there is none.
 *
 * The comparison itself is `@einv/shared`'s (`invoicing/duplicates`): the same paper is the same
 * supplier's same printed number, not the same file. The query loads the tenant's numbered invoices and
 * lets the domain decide, which keeps one definition of "duplicate" — a SQL equality on
 * `invoice_number` would miss `2026-0042` typed as `2026  0042`, and a `LIKE` would invent matches.
 *
 * Only the tenant's own rows are read, and the oldest match wins: the invoice a person is sent back to
 * should be the original capture, not the most recent copy of it. When the number of invoices makes the
 * scan expensive, the next step is a normalised `duplicate_key` column with a unique index (ADR 0008) —
 * which is also what makes the rule race-proof, and why it is not pretended to be one today.
 */
export async function findDuplicateInvoice(
  input: FindDuplicateInvoiceInput,
): Promise<InvoiceSummaryView | null> {
  if (invoiceIdentity(input) === null) {
    return null;
  }

  const rows = await withDatabase((client) =>
    client.invoice.findMany({
      where: { companyId: input.companyId, invoiceNumber: { not: null } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { lines: { select: { id: true } } },
    }),
  );

  const match = findDuplicate(input, rows);

  return match === null ? null : toInvoiceSummaryView(match as unknown as InvoiceRow);
}

export type SaveCapturedInvoiceInput = {
  readonly tenant: Tenant;
  readonly draft: NormalisedDraft;
  readonly captureSource: CaptureSource;
  /** The extraction this draft came from, linked in the same transaction. */
  readonly extractionId?: string | null;
};

export async function saveCapturedInvoice(input: SaveCapturedInvoiceInput): Promise<InvoiceView> {
  assertSavable(input.draft);
  assertTotalsConsistent(input.draft.totals);

  const duplicate = await findDuplicateInvoice({
    companyId: input.tenant.companyId,
    invoiceNumber: input.draft.invoiceNumber,
    supplierVatNumber: input.draft.supplier.vatNumber,
    supplierName: input.draft.supplier.name,
  });

  if (duplicate !== null) {
    throw new DomainError(
      DomainErrorCode.DUPLICATE_INVOICE,
      `kjo faturë është regjistruar më parë: ${duplicate.supplierName}${
        duplicate.invoiceNumber === null ? '' : `, nr. ${duplicate.invoiceNumber}`
      }; fatura nuk u ruajt dy herë`,
      // The same fields the duplicate-check route returns, so the review screen parses one shape.
      {
        id: duplicate.id,
        invoiceNumber: duplicate.invoiceNumber,
        supplierName: duplicate.supplierName,
        issueDate: duplicate.issueDate,
        totalMinor: duplicate.totalMinor,
        currency: duplicate.currency,
      },
    );
  }

  const data = toInvoiceCreateData(input.draft, {
    companyId: input.tenant.companyId,
    captureSource: input.captureSource,
  });

  const row = await withDatabase(async (client) => {
    const created = await client.invoice.create({ data, include: { lines: true } });

    if (input.extractionId !== undefined && input.extractionId !== null) {
      await client.extraction.updateMany({
        where: { id: input.extractionId, companyId: input.tenant.companyId },
        data: { invoiceId: created.id },
      });
    }

    return created;
  });

  return toInvoiceView(row as unknown as InvoiceRow);
}

export type ListInvoicesOptions = {
  readonly limit?: number;
  /**
   * What the person typed in the list's search box: a supplier's name or something printed on a
   * line (`Kafe 1 kg`). Every word must be found in one of the two places — see
   * `invoiceSearchTerms` for what counts as a word.
   */
  readonly search?: string;
};

/**
 * How much of the search box is used. The page caps its input at this length too; the repository
 * caps again because a hand-made request is not more trustworthy than a form.
 */
export const INVOICE_SEARCH_MAX_LENGTH = 100;

/** Pasted paragraphs stop being a query here; a search this long is not a search. */
const MAX_SEARCH_TERMS = 8;

/**
 * The search box's text, as the query uses it: trimmed, inner whitespace collapsed to one space,
 * and cut at `INVOICE_SEARCH_MAX_LENGTH`.
 *
 * Case is deliberately *not* folded here. Postgres does the matching with `mode: 'insensitive'`, so
 * `KAFE` and `kafe` find the same rows without this module pretending to know Albanian casing.
 */
export function normaliseInvoiceSearch(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim().slice(0, INVOICE_SEARCH_MAX_LENGTH).trim();
}

/**
 * The words a search is made of: `kafe sh.p.k` is two terms, and each has to match somewhere.
 *
 * Splitting is what makes `Kafe Sh.p.k` find a supplier stored as `NPT Kafe Sh.p.k` while `Kafe Uji`
 * still refuses a row that only mentions coffee. Repeats are dropped, so `kafe kafe` is one clause.
 */
export function invoiceSearchTerms(value: string | null | undefined): readonly string[] {
  const search = normaliseInvoiceSearch(value);
  if (search === '') {
    return [];
  }

  const terms: string[] = [];
  const seen = new Set<string>();

  for (const term of search.split(' ')) {
    const key = term.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    terms.push(term);
  }

  return terms.slice(0, MAX_SEARCH_TERMS);
}

/**
 * Newest first. `id` breaks the tie, so a list is stable across two identical `createdAt` values.
 *
 * With a search, the supplier's name and the line descriptions are searched by the same words: the
 * card shows the supplier, and "which invoice had the coffee on it" is answered by the lines, so a
 * person should not have to guess which side of the paper they remember. Nothing else is matched —
 * an invoice number has its own, exact identity in `findDuplicateInvoice`.
 */
export async function listInvoices(
  companyId: string,
  options: ListInvoicesOptions = {},
): Promise<readonly InvoiceSummaryView[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const terms = invoiceSearchTerms(options.search);

  const rows = await withDatabase((client) =>
    client.invoice.findMany({
      where: {
        companyId,
        ...(terms.length === 0
          ? {}
          : {
              // `AND` of `OR`s: every word must appear, in either place. A single `contains` per word
              // keeps `Kafe Sh.p.k` from needing to be one contiguous string in the stored name.
              AND: terms.map((term) => ({
                OR: [
                  { supplierName: { contains: term, mode: 'insensitive' as const } },
                  {
                    lines: {
                      some: { description: { contains: term, mode: 'insensitive' as const } },
                    },
                  },
                ],
              })),
            }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: { lines: { select: { id: true } } },
    }),
  );

  return rows.map((row) => toInvoiceSummaryView(row as unknown as InvoiceRow));
}

export async function getInvoiceById(
  companyId: string,
  invoiceId: string,
): Promise<InvoiceView | null> {
  const row = await withDatabase((client) =>
    client.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { lines: { orderBy: { position: 'asc' } } },
    }),
  );

  return row === null ? null : toInvoiceView(row as unknown as InvoiceRow);
}

/** Re-exported so the API layer imports its view types from the repository, not from internals. */
export type { InvoiceLineRow, InvoiceSummaryView, InvoiceView } from './view';
