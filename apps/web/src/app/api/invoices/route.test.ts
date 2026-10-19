import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetServerEnv } from '@/lib/env';

import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  listInvoices: vi.fn(),
  saveCapturedInvoice: vi.fn(),
}));

vi.mock('@einv/db', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    listInvoices: mocks.listInvoices,
    saveCapturedInvoice: mocks.saveCapturedInvoice,
  };
});

// The session is resolved from a cookie and a database; neither belongs in a route test. What matters here
// is that the route *asks*, and that it uses the company the answer names.
vi.mock('@/server/auth/session', () => ({
  requireActor: mocks.requireActor,
}));

const tenant = {
  companyId: 'company-1',
  companyName: 'Demo Market Sh.p.k',
  currency: 'EUR',
  countryCode: 'XK',
  taxRates: [
    { id: 'vat-18', name: 'TVSH 18%', category: 'STANDARD', ratePercent: '18' },
    { id: 'vat-8', name: 'TVSH 8%', category: 'REDUCED', ratePercent: '8' },
  ],
  defaultTaxRateId: 'vat-18',
};

const reviewed = {
  currency: 'EUR',
  supplier: { name: 'NPT Kafe Sh.p.k', vatNumber: '811234567', countryCode: 'XK' },
  buyer: { name: 'Demo Market Sh.p.k' },
  invoiceNumber: '2026-0042',
  issueDate: '2026-03-14',
  documentDiscount: '2.00',
  captureSource: 'CAMERA',
  extractionId: 'extraction-1',
  lines: [{ description: 'Kafe 1 kg', quantity: '3', unitPrice: '12.50', taxRateId: 'vat-18' }],
};

function jsonRequest(body: unknown): Request {
  return new Request('http://test/api/invoices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function listRequest(): Request {
  return new Request('http://test/api/invoices');
}

async function payload(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  resetServerEnv();
  mocks.requireActor.mockResolvedValue({
    sessionId: 'session-1',
    userId: 'user-1',
    email: 'arta@example.com',
    name: 'Arta',
    imageUrl: null,
    role: 'OWNER',
    tenant,
    expiresAt: new Date('2026-11-16T10:00:00.000Z'),
  });
  mocks.listInvoices.mockResolvedValue([{ id: 'invoice-1', supplierName: 'Kafe' }]);
  mocks.saveCapturedInvoice.mockResolvedValue({ id: 'invoice-1' });
});

describe('GET /api/invoices', () => {
  it('lists the actor tenant invoices, scoped to the company the session named', async () => {
    const response = await GET(listRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      companyId: 'company-1',
      invoices: [{ id: 'invoice-1', supplierName: 'Kafe' }],
    });
    expect(mocks.listInvoices).toHaveBeenCalledWith('company-1', { search: '' });
  });

  it('passes the search box text on, so the API filters the way the page does', async () => {
    const response = await GET(new Request('http://test/api/invoices?q=npt%20kafe'));

    expect(response.status).toBe(200);
    expect(mocks.listInvoices).toHaveBeenCalledWith('company-1', { search: 'npt kafe' });
  });

  it('answers 401 for a request with no session, and reads nothing', async () => {
    const { AuthError, AuthErrorCode } = await import('@/server/auth/errors');
    mocks.requireActor.mockRejectedValue(
      new AuthError(AuthErrorCode.UNAUTHENTICATED, 'duhet të hysh për të vazhduar'),
    );

    const response = await GET(listRequest());

    expect(response.status).toBe(401);
    await expect(payload(response)).resolves.toMatchObject({
      error: { code: 'UNAUTHENTICATED' },
    });
    expect(mocks.listInvoices).not.toHaveBeenCalled();
  });
});

describe('POST /api/invoices', () => {
  it('recomputes the reviewed text with the domain and stores the result', async () => {
    const response = await POST(jsonRequest(reviewed));

    expect(response.status).toBe(201);
    await expect(payload(response)).resolves.toEqual({ invoice: { id: 'invoice-1' } });

    const written = mocks.saveCapturedInvoice.mock.calls[0]?.[0] as {
      tenant: unknown;
      captureSource: string;
      extractionId: string;
      draft: { isSaveable: boolean; totals: { totalMinor: bigint } };
    };

    expect(written.tenant).toBe(tenant);
    expect(written.captureSource).toBe('CAMERA');
    expect(written.extractionId).toBe('extraction-1');
    expect(written.draft.isSaveable).toBe(true);
    // 3 × 12,50 = 37,50 + 6,75 VAT − 2,00 = 42,25
    expect(written.draft.totals.totalMinor).toBe(4225n);
  });

  it('ignores a capture source it does not know, rather than storing it', async () => {
    await POST(jsonRequest({ ...reviewed, captureSource: 'TELEPATHY' }));

    expect(mocks.saveCapturedInvoice.mock.calls[0]?.[0]).toMatchObject({ captureSource: 'UPLOAD' });
  });

  it('refuses a draft that is still broken, and hands the problems back', async () => {
    const response = await POST(jsonRequest({ ...reviewed, supplier: { name: '' } }));

    expect(response.status).toBe(422);

    const body = await payload(response);
    expect(body['error']).toMatchObject({ code: 'INVALID_INVOICE' });

    const draft = body['draft'] as { isSaveable: boolean; problems: readonly { code: string }[] };
    expect(draft.isSaveable).toBe(false);
    expect(draft.problems.map((problem) => problem.code)).toContain('MISSING_SUPPLIER_NAME');
    expect(mocks.saveCapturedInvoice).not.toHaveBeenCalled();
  });

  it('refuses a line whose price cannot be parsed, instead of storing a zero', async () => {
    const response = await POST(
      jsonRequest({
        ...reviewed,
        lines: [{ description: 'X', quantity: '1', unitPrice: 'abc', taxRateId: 'vat-18' }],
      }),
    );

    expect(response.status).toBe(422);
    const draft = (await payload(response))['draft'] as { problems: readonly { code: string }[] };
    expect(draft.problems.map((problem) => problem.code)).toContain('INVALID_UNIT_PRICE');
  });

  it('refuses a draft whose invoice number is already stored, and names the existing invoice', async () => {
    const { DomainError, DomainErrorCode } = await import('@einv/shared');
    mocks.saveCapturedInvoice.mockRejectedValue(
      new DomainError(
        DomainErrorCode.DUPLICATE_INVOICE,
        'kjo faturë është regjistruar më parë (NPT Kafe Sh.p.k, nr. 2026-0042)',
        {
          id: 'invoice-old',
          invoiceNumber: '2026-0042',
          supplierName: 'NPT Kafe Sh.p.k',
          issueDate: '2026-03-14',
          totalMinor: '4225',
          currency: 'EUR',
        },
      ),
    );

    const response = await POST(jsonRequest(reviewed));

    expect(response.status).toBe(409);

    const body = await payload(response);
    expect(body['error']).toMatchObject({
      code: 'DUPLICATE_INVOICE',
      details: { id: 'invoice-old', invoiceNumber: '2026-0042', totalMinor: '4225' },
    });
  });

  it('answers 503 when there is no database to write to', async () => {
    const { DatabaseUnavailableError } = await import('@einv/db');
    mocks.requireActor.mockRejectedValue(new DatabaseUnavailableError('no database'));

    const response = await POST(jsonRequest(reviewed));

    expect(response.status).toBe(503);
    expect(mocks.saveCapturedInvoice).not.toHaveBeenCalled();
  });
});
