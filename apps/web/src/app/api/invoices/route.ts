import { CaptureSource, listInvoices, saveCapturedInvoice } from '@einv/db';
import { normaliseInvoiceSubmission } from '@einv/shared';

import { sq } from '@/lib/copy/sq';
import { requireActor } from '@/server/auth/session';
import {
  asRecord,
  jsonResponse,
  readEnumField,
  readJsonBody,
  readStringField,
  toErrorResponse,
} from '@/server/http';
import { toDraftView } from '@/server/invoices/draft-view';

/**
 * The invoices collection.
 *
 * `GET` lists what this company has captured — newest first, tenant-scoped, money as minor-unit strings.
 * `?q=` narrows it to a supplier's name or a line description, with the same match the list page uses,
 * so the phone client can offer a search box without re-implementing one.
 *
 * `POST` saves a *reviewed* draft, and the interesting part is that it re-parses everything the browser
 * sent. The client's job is to show what the human confirmed; the server's job is to recompute it, with
 * the same `@einv/shared` code the review screen used, and to refuse anything that is still flagged as
 * an error. A 422 here carries the fresh draft back, so the review screen can show exactly which field
 * is still wrong instead of a generic failure.
 */
export const dynamic = 'force-dynamic';

const CAPTURE_SOURCES = [CaptureSource.CAMERA, CaptureSource.UPLOAD, CaptureSource.MANUAL] as const;

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireActor(request);
    const search = new URL(request.url).searchParams.get('q') ?? '';
    const invoices = await listInvoices(actor.tenant.companyId, { search });

    return jsonResponse({ companyId: actor.tenant.companyId, invoices });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireActor(request);
    const payload = await readJsonBody(request);
    const record = asRecord(payload) ?? {};
    const tenant = actor.tenant;

    const draft = normaliseInvoiceSubmission(payload, {
      defaultCurrency: tenant.currency,
      taxRates: tenant.taxRates,
      fallbackTaxRateId: tenant.defaultTaxRateId,
    });

    if (!draft.isSaveable) {
      return jsonResponse(
        {
          error: {
            code: 'INVALID_INVOICE',
            message: sq.api.invoiceNotSaveable,
          },
          draft: toDraftView(draft),
        },
        422,
      );
    }

    const invoice = await saveCapturedInvoice({
      tenant,
      draft,
      captureSource: readEnumField(record, 'captureSource', CAPTURE_SOURCES, CaptureSource.UPLOAD),
      extractionId: readStringField(record, 'extractionId'),
    });

    return jsonResponse({ invoice }, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
