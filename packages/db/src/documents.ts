/**
 * The `document_blobs` index — the database's record of which bytes a tenant owns (ADR 0004).
 *
 * The bytes themselves live in storage; this table is what makes them *owned*: a file with no row is
 * garbage, and a row whose file has gone is an incident. Storing the SHA-256 here (rather than only in
 * the upload response) is what lets a later job prove the bytes it reads are the bytes that were
 * uploaded.
 */

import { withDatabase } from './client';

export const DocumentKind = {
  /** A photograph of an invoice, as the phone produced it. */
  SOURCE_IMAGE: 'SOURCE_IMAGE',
  /** A PDF of an invoice, stored and read exactly as uploaded — never converted to an image. */
  SOURCE_PDF: 'SOURCE_PDF',
} as const;

export type DocumentKind = (typeof DocumentKind)[keyof typeof DocumentKind];

export type RecordDocumentInput = {
  readonly companyId: string;
  readonly kind: DocumentKind;
  /** `local` | `s3`, as configured at upload time. */
  readonly storageDriver: string;
  /** `companyId/yyyy/mm/uuid.ext` — server-generated, never derived from the uploaded filename. */
  readonly storageKey: string;
  /** Sniffed from the stored bytes, never the client's declared type. */
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly originalFilename: string | null;
};

export type DocumentRow = {
  readonly id: string;
  readonly companyId: string;
  readonly kind: string;
  readonly storageDriver: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly originalFilename: string | null;
  readonly createdAt: Date;
};

export async function recordDocument(input: RecordDocumentInput): Promise<DocumentRow> {
  return withDatabase((client) =>
    client.documentBlob.create({
      data: {
        companyId: input.companyId,
        kind: input.kind,
        storageDriver: input.storageDriver,
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        sha256: input.sha256,
        originalFilename: input.originalFilename,
      },
    }),
  );
}

/** Scoped by `companyId`, always: a document id from another tenant must read as "not found". */
export async function findDocumentById(
  companyId: string,
  documentId: string,
): Promise<DocumentRow | null> {
  return withDatabase((client) =>
    client.documentBlob.findFirst({ where: { id: documentId, companyId } }),
  );
}

export async function findDocumentByKey(
  companyId: string,
  storageKey: string,
): Promise<DocumentRow | null> {
  return withDatabase((client) =>
    client.documentBlob.findFirst({ where: { storageKey, companyId } }),
  );
}
