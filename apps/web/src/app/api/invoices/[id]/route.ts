import { getInvoiceById } from '@einv/db';

import { sq } from '@/lib/copy/sq';
import { requireActor } from '@/server/auth/session';
import { jsonResponse, toErrorResponse } from '@/server/http';

/**
 * `GET /api/invoices/{id}` — one invoice, tenant-scoped.
 *
 * A row that belongs to another company is indistinguishable from a row that does not exist, which is
 * the correct answer: "not yours" is information nobody outside the tenant is entitled to.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor(request);
    const { id } = await context.params;
    const invoice = await getInvoiceById(actor.tenant.companyId, id);

    if (invoice === null) {
      return jsonResponse(
        {
          error: { code: 'INVOICE_NOT_FOUND', message: sq.api.invoiceNotFound },
        },
        404,
      );
    }

    return jsonResponse({ invoice });
  } catch (error) {
    return toErrorResponse(error);
  }
}
