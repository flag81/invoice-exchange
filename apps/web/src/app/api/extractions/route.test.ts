import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetServerEnv } from '@/lib/env';

import { POST } from './route';

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  findDocumentById: vi.fn(),
  recordExtraction: vi.fn(),
}));

vi.mock('@einv/db', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    findDocumentById: mocks.findDocumentById,
    recordExtraction: mocks.recordExtraction,
  };
});

vi.mock('@/server/auth/session', () => ({ requireActor: mocks.requireActor }));

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

const STORAGE_KEY = 'company-1/2026/03/document-1.png';

let storageRoot: string;

function extractRequest(body: unknown): Request {
  return new Request('http://test/api/extractions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function payload(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'einv-extract-'));
  vi.stubEnv('STORAGE_LOCAL_ROOT', storageRoot);
  vi.stubEnv('AI_PROVIDER', 'stub');
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
  mocks.findDocumentById.mockResolvedValue({
    id: 'document-1',
    companyId: 'company-1',
    kind: 'SOURCE_IMAGE',
    storageDriver: 'local',
    storageKey: STORAGE_KEY,
    mimeType: 'image/png',
    byteSize: 5,
    sha256: 'abc',
    originalFilename: 'invoice.png',
    createdAt: new Date('2026-03-14T09:00:00.000Z'),
  });
  mocks.recordExtraction.mockResolvedValue({ id: 'extraction-1' });

  const absolute = join(storageRoot, STORAGE_KEY);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, Uint8Array.of(1, 2, 3, 4, 5));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetServerEnv();
  vi.clearAllMocks();
  await rm(storageRoot, { recursive: true, force: true });
});

describe('POST /api/extractions', () => {
  it('reads the stored image with the configured provider and normalises the answer', async () => {
    const response = await POST(extractRequest({ documentId: 'document-1' }));
    const body = await payload(response);

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ extractionId: 'extraction-1', provider: 'stub', model: 'stub-1' });
    expect(body['taxRates']).toEqual([
      { id: 'vat-18', label: 'TVSH 18% (18%)', ratePercent: '18', category: 'STANDARD' },
      { id: 'vat-8', label: 'TVSH 8% (8%)', ratePercent: '8', category: 'REDUCED' },
    ]);

    const draft = body['draft'] as Record<string, unknown>;
    expect(draft['isSaveable']).toBe(true);
    expect(draft['currency']).toBe('EUR');
    expect((draft['lines'] as readonly unknown[]).length).toBeGreaterThan(0);
    expect(typeof (draft['totals'] as Record<string, unknown>)['total']).toBe('string');

    expect(mocks.recordExtraction.mock.calls[0]?.[0]).toMatchObject({
      companyId: 'company-1',
      documentBlobId: 'document-1',
      status: 'SUCCEEDED',
      provider: 'stub',
    });
  });

  it('asks for a document id when the body has none', async () => {
    const response = await POST(extractRequest({}));

    expect(response.status).toBe(400);
    expect(await payload(response)).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  });

  it('answers 404 for a document that is not in this company', async () => {
    mocks.findDocumentById.mockResolvedValue(null);

    const response = await POST(extractRequest({ documentId: 'someone-elses' }));

    expect(response.status).toBe(404);
    expect(await payload(response)).toMatchObject({ error: { code: 'DOCUMENT_NOT_FOUND' } });
  });

  it('reports a missing file as an incident, not as a bad request', async () => {
    await rm(join(storageRoot, STORAGE_KEY));

    const response = await POST(extractRequest({ documentId: 'document-1' }));

    expect(response.status).toBe(500);
    expect(await payload(response)).toMatchObject({ error: { code: 'DOCUMENT_BYTES_MISSING' } });
  });

  it('records a failed attempt before reporting the provider failure', async () => {
    vi.stubEnv('AI_PROVIDER', 'gemini');
    vi.stubEnv('GEMINI_API_KEY', 'key');
    resetServerEnv();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const response = await POST(extractRequest({ documentId: 'document-1' }));

    expect(response.status).toBe(502);
    expect(await payload(response)).toMatchObject({ error: { code: 'EXTRACTION_FAILED' } });
    expect(mocks.recordExtraction.mock.calls[0]?.[0]).toMatchObject({
      status: 'FAILED',
      rawJson: null,
      provider: 'gemini',
    });
    expect(mocks.recordExtraction.mock.calls[0]?.[0]?.errorMessage).toContain('nxjerrje dështoi');
  });
});
