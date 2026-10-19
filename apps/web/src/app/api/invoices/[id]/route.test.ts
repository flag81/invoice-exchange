import { describe, expect, it, vi } from 'vitest';

import { resetServerEnv } from '@/lib/env';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  getInvoiceById: vi.fn(),
}));

vi.mock('@einv/db', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    getInvoiceById: mocks.getInvoiceById,
  };
});

vi.mock('@/server/auth/session', () => ({ requireActor: mocks.requireActor }));

const tenant = {
  companyId: 'company-1',
  companyName: 'Demo Market Sh.p.k',
  currency: 'EUR',
  countryCode: 'XK',
  taxRates: [],
  defaultTaxRateId: undefined,
};

const actor = {
  sessionId: 'session-1',
  userId: 'user-1',
  email: 'arta@example.com',
  name: 'Arta',
  imageUrl: null,
  role: 'OWNER',
  tenant,
  expiresAt: new Date('2026-11-16T10:00:00.000Z'),
};

const context = { params: Promise.resolve({ id: 'invoice-1' }) };

describe('GET /api/invoices/[id]', () => {
  it('returns the invoice the tenant owns', async () => {
    mocks.requireActor.mockResolvedValue(actor);
    mocks.getInvoiceById.mockResolvedValue({ id: 'invoice-1', supplier: { name: 'Kafe' } });

    const response = await GET(new Request('http://test/api/invoices/invoice-1'), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      invoice: { id: 'invoice-1', supplier: { name: 'Kafe' } },
    });
    expect(mocks.getInvoiceById).toHaveBeenCalledWith('company-1', 'invoice-1');
  });

  it('answers 404 for an invoice of another tenant — "not yours" and "not there" look the same', async () => {
    mocks.requireActor.mockResolvedValue(actor);
    mocks.getInvoiceById.mockResolvedValue(null);

    const response = await GET(new Request('http://test/api/invoices/invoice-9'), context);

    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'INVOICE_NOT_FOUND',
    );
  });

  it('answers 503 when there is no database to read from', async () => {
    const { DatabaseUnavailableError } = await import('@einv/db');
    mocks.requireActor.mockRejectedValue(new DatabaseUnavailableError('no database'));
    resetServerEnv();

    const response = await GET(new Request('http://test/api/invoices/invoice-1'), context);

    expect(response.status).toBe(503);
  });
});
