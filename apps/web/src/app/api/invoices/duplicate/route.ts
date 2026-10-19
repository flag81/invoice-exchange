import { findDuplicateInvoice } from '@einv/db';

import { requireActor } from '@/server/auth/session';
import { jsonResponse, toErrorResponse } from '@/server/http';

/**
 * The duplicate check the review screen calls *before* the save button.
 *
 * `GET /api/invoices/duplicate?invoiceNumber=…&supplierVatNumber=…&supplierName=…` answers one
 * question — *is this supplier's number already stored?* — and answers it with the invoice itself, so the
 * screen can show the way to it instead of only forbidding the save.
 *
 * It is a courtesy, not the control: `POST /api/invoices` refuses the same draft with a 409 by itself
 * (`saveCapturedInvoice` → `DUPLICATE_INVOICE`), so a browser that skips this call gains nothing.
 * A request with no number (or an empty query) simply answers `{ duplicate: null }`: there is nothing to
 * compare, and a 400 here would turn a half-filled form into an error message.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireActor(request);
    const params = new URL(request.url).searchParams;

    const duplicate = await findDuplicateInvoice({
      companyId: actor.tenant.companyId,
      invoiceNumber: params.get('invoiceNumber'),
      supplierVatNumber: params.get('supplierVatNumber'),
      supplierName: params.get('supplierName'),
    });

    return jsonResponse({ duplicate });
  } catch (error) {
    return toErrorResponse(error);
  }
}
