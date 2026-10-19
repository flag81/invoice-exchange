import { ExtractionStatus, findDocumentById, recordExtraction } from '@einv/db';
import { normaliseExtractedInvoice } from '@einv/shared';

import { sq } from '@/lib/copy/sq';
import { serverEnv } from '@/lib/env';
import { requireActor } from '@/server/auth/session';
import { selectExtractionProvider } from '@/server/extraction';
import {
  asRecord,
  jsonResponse,
  readJsonBody,
  readStringField,
  toErrorResponse,
} from '@/server/http';
import { toDraftView, toTaxRateOptions } from '@/server/invoices/draft-view';
import { getObject } from '@/server/storage/local-storage';

/**
 * `POST /api/extractions` — read an uploaded document (photo or PDF) and return a *draft*, never an
 * invoice.
 *
 * The route does four things in a fixed order, and the order is the design:
 *
 *   1. **The bytes come from storage, by key, scoped to the tenant.** The client sends a document id,
 *      never a path — and a document id from another company resolves to nothing.
 *   2. **The provider reads them.** Whichever provider is configured; the response says which one and
 *      how long it took, because "the model changed" is a support question that needs an answer.
 *   3. **The answer is normalised by the domain**, not by the route: exact money, the tenant's own tax
 *      rates, and a list of everything the reader had to assume.
 *   4. **The attempt is recorded either way.** A successful extraction stores the raw answer and the
 *      normalised draft; a failed one stores the error. Nothing about a failure is thrown away.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireActor(request);
    const env = serverEnv();
    const body = asRecord(await readJsonBody(request));
    const documentId = body === null ? null : readStringField(body, 'documentId');

    if (documentId === null) {
      return jsonResponse(
        { error: { code: 'INVALID_REQUEST', message: sq.api.documentIdRequired } },
        400,
      );
    }

    const tenant = actor.tenant;
    const document = await findDocumentById(tenant.companyId, documentId);

    if (document === null) {
      return jsonResponse(
        {
          error: {
            code: 'DOCUMENT_NOT_FOUND',
            message: sq.api.documentNotFound,
          },
        },
        404,
      );
    }

    const bytes = await getObject(env.STORAGE_LOCAL_ROOT, document.storageKey);

    if (bytes === null) {
      return jsonResponse(
        {
          error: {
            code: 'DOCUMENT_BYTES_MISSING',
            message: sq.api.documentBytesMissing(document.id),
          },
        },
        500,
      );
    }

    const provider = selectExtractionProvider(env);

    try {
      const result = await provider.extract({
        bytes,
        mimeType: document.mimeType,
        filename: document.originalFilename,
      });

      const draft = normaliseExtractedInvoice(result.raw, {
        defaultCurrency: tenant.currency,
        taxRates: tenant.taxRates,
        fallbackTaxRateId: tenant.defaultTaxRateId,
      });
      const view = toDraftView(draft);

      const extraction = await recordExtraction({
        companyId: tenant.companyId,
        documentBlobId: document.id,
        status: ExtractionStatus.SUCCEEDED,
        provider: result.provider,
        model: result.model,
        rawJson: JSON.stringify(result.raw),
        draftJson: JSON.stringify(view),
        errorMessage: null,
        durationMs: result.durationMs,
      });

      return jsonResponse(
        {
          extractionId: extraction.id,
          provider: result.provider,
          model: result.model,
          durationMs: result.durationMs,
          draft: view,
          taxRates: toTaxRateOptions(tenant.taxRates),
        },
        201,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await recordExtraction({
        companyId: tenant.companyId,
        documentBlobId: document.id,
        status: ExtractionStatus.FAILED,
        provider: provider.name,
        model: provider.model,
        rawJson: null,
        draftJson: null,
        errorMessage: message,
        durationMs: null,
      }).catch(() => undefined);

      throw error;
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
