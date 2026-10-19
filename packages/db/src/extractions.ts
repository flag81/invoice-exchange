/**
 * Recording what an extraction produced — including the ones that failed.
 *
 * An extraction attempt is evidence. The raw answer is kept verbatim next to the normalised draft, so
 * "the model read 8 % where the paper says 18 %" is a question that can be answered later from the
 * database rather than from a support ticket. Nothing here decides whether the result is good: that is
 * the review screen's job, and its decisions are the `problems` inside the stored draft.
 */

import { withDatabase } from './client';

export const ExtractionStatus = {
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
} as const;

export type ExtractionStatus = (typeof ExtractionStatus)[keyof typeof ExtractionStatus];

export type RecordExtractionInput = {
  readonly companyId: string;
  readonly documentBlobId: string | null;
  readonly status: ExtractionStatus;
  /** `gemini` | `stub`. */
  readonly provider: string;
  readonly model: string | null;
  /** The provider's answer, verbatim, as JSON text. `null` when the call failed. */
  readonly rawJson: string | null;
  /** The normalised draft, as JSON text. `null` when normalisation could not run. */
  readonly draftJson: string | null;
  readonly errorMessage: string | null;
  readonly durationMs: number | null;
};

export type ExtractionRow = {
  readonly id: string;
  readonly companyId: string;
  readonly documentBlobId: string | null;
  readonly status: string;
  readonly provider: string;
  readonly model: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
};

export async function recordExtraction(input: RecordExtractionInput): Promise<ExtractionRow> {
  return withDatabase((client) =>
    client.extraction.create({
      data: {
        companyId: input.companyId,
        documentBlobId: input.documentBlobId,
        status: input.status,
        provider: input.provider,
        model: input.model,
        rawJson: input.rawJson,
        draftJson: input.draftJson,
        errorMessage: input.errorMessage,
        durationMs: input.durationMs,
        completedAt: new Date(),
      },
      select: {
        id: true,
        companyId: true,
        documentBlobId: true,
        status: true,
        provider: true,
        model: true,
        createdAt: true,
        completedAt: true,
      },
    }),
  );
}

/**
 * Links a saved invoice to the extraction it came from, inside one transaction with the insert.
 * The `companyId` filter is what stops an extraction id from another tenant being claimed.
 */
export async function attachExtractionToInvoice(
  companyId: string,
  extractionId: string,
  invoiceId: string,
): Promise<void> {
  await withDatabase((client) =>
    client.extraction.updateMany({
      where: { id: extractionId, companyId },
      data: { invoiceId },
    }),
  );
}
