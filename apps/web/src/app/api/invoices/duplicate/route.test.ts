import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetServerEnv } from '@/lib/env';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  findDuplicateInvoice: vi.fn(),
}));

vi.mock('@einv/db', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    findDuplicateInvoice: mocks.findDuplicateInvoice,
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

const existing = {
  id: 'invoice-old',
  status: 'DRAFT',
  currency: 'EUR',
  invoiceNumber: '2026-0042',
  supplierName: 'NPT Kafe Sh.p.k',
  issueDate: '2026-03-14',
  totalMinor: '4225',
  payableMinor: '4225',
  lineCount: 1,
  createdAt: '2026-03-15T09:00:00.000Z',
};

function request(query: string): Request {
  return new Request(`http://test/api/invoices/duplicate${query}`);
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
  mocks.findDuplicateInvoice.mockResolvedValue(null);
});

describe('GET /api/invoices/duplicate', () => {
  it('answers with the invoice already stored for this supplier and number', async () => {
    mocks.findDuplicateInvoice.mockResolvedValue(existing);

    const response = await GET(
      request('?invoiceNumber=2026-0042&supplierVatNumber=811234567&supplierName=NPT+Kafe'),
    );

    expect(response.status).toBe(200);
    await expect(payload(response)).resolves.toEqual({ duplicate: existing });
    expect(mocks.findDuplicateInvoice).toHaveBeenCalledWith({
      companyId: 'company-1',
      invoiceNumber: '2026-0042',
      supplierVatNumber: '811234567',
      supplierName: 'NPT Kafe',
    });
  });

  it('answers null when the number is new to this company', async () => {
    const response = await GET(request('?invoiceNumber=2027-0001&supplierName=NPT+Kafe'));

    expect(response.status).toBe(200);
    await expect(payload(response)).resolves.toEqual({ duplicate: null });
    expect(mocks.findDuplicateInvoice).toHaveBeenCalledWith({
      companyId: 'company-1',
      invoiceNumber: '2027-0001',
      supplierVatNumber: null,
      supplierName: 'NPT Kafe',
    });
  });

  it('answers null rather than 400 for a form that has no number yet', async () => {
    const response = await GET(request(''));

    expect(response.status).toBe(200);
    await expect(payload(response)).resolves.toEqual({ duplicate: null });
    expect(mocks.findDuplicateInvoice).toHaveBeenCalledWith({
      companyId: 'company-1',
      invoiceNumber: null,
      supplierVatNumber: null,
      supplierName: null,
    });
  });

  it('answers 503 when there is no database to ask', async () => {
    const { DatabaseUnavailableError } = await import('@einv/db');
    mocks.requireActor.mockRejectedValue(new DatabaseUnavailableError('no database'));

    const response = await GET(request('?invoiceNumber=2026-0042'));

    expect(response.status).toBe(503);
    expect(mocks.findDuplicateInvoice).not.toHaveBeenCalled();
  });
});
