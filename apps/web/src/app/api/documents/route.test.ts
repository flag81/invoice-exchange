import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetServerEnv } from '@/lib/env';

import { POST } from './route';

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  recordDocument: vi.fn(),
}));

vi.mock('@einv/db', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    recordDocument: mocks.recordDocument,
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

/** A minimal PNG: the right magic number and nothing else. */
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00);

/** A minimal PDF: `%PDF-1.7` and nothing else. */
const PDF = Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);

let storageRoot: string;

function uploadRequest(
  bytes: Uint8Array,
  name = 'invoice.png',
  type = 'image/png',
  field = 'file',
): Request {
  const form = new FormData();
  // `new Uint8Array(bytes)` copies into a plain ArrayBuffer, which is what `BlobPart` requires.
  form.append(field, new File([new Uint8Array(bytes)], name, { type }));

  return new Request('http://test/api/documents', { method: 'POST', body: form });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'einv-upload-'));
  vi.stubEnv('STORAGE_LOCAL_ROOT', storageRoot);
  vi.stubEnv('STORAGE_DRIVER', 'local');
  vi.stubEnv('STORAGE_MAX_UPLOAD_BYTES', '');
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
  mocks.recordDocument.mockImplementation(
    (input: {
      storageKey: string;
      sha256: string;
      kind: string;
      mimeType: string;
      byteSize: number;
      originalFilename: string | null;
    }) =>
      Promise.resolve({
        id: 'document-1',
        companyId: 'company-1',
        kind: input.kind,
        storageDriver: 'local',
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        sha256: input.sha256,
        originalFilename: input.originalFilename,
        createdAt: new Date('2026-03-14T09:00:00.000Z'),
      }),
  );
});

afterEach(async () => {
  vi.unstubAllEnvs();
  resetServerEnv();
  vi.clearAllMocks();
  await rm(storageRoot, { recursive: true, force: true });
});

describe('POST /api/documents', () => {
  it('stores the image under a server-generated key and returns the index row', async () => {
    const response = await POST(uploadRequest(PNG));
    const payload = await body(response);

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      documentId: 'document-1',
      mimeType: 'image/png',
      byteSize: PNG.byteLength,
      originalFilename: 'invoice.png',
      uploadedAt: '2026-03-14T09:00:00.000Z',
    });

    const key = mocks.recordDocument.mock.calls[0]?.[0]?.storageKey as string;
    expect(key).toMatch(/^company-1\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(mocks.recordDocument.mock.calls[0]?.[0]).toMatchObject({ kind: 'SOURCE_IMAGE' });
    await expect(
      readdir(join(storageRoot, key.split('/').slice(0, 3).join('/'))),
    ).resolves.toHaveLength(1);
  });

  it('accepts a PDF, indexing it as SOURCE_PDF under a .pdf key', async () => {
    const response = await POST(uploadRequest(PDF, 'fatura-2026.pdf', 'application/pdf'));
    const payload = await body(response);

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      mimeType: 'application/pdf',
      byteSize: PDF.byteLength,
      originalFilename: 'fatura-2026.pdf',
    });

    const input = mocks.recordDocument.mock.calls[0]?.[0];
    expect(input).toMatchObject({ kind: 'SOURCE_PDF', mimeType: 'application/pdf' });
    expect(input?.storageKey).toMatch(/^company-1\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
  });

  it('stores a PDF as a PDF even when the client calls it an image', async () => {
    const response = await POST(uploadRequest(PDF, 'scan.jpg', 'image/jpeg'));

    expect(response.status).toBe(201);
    expect(mocks.recordDocument.mock.calls[0]?.[0]).toMatchObject({
      kind: 'SOURCE_PDF',
      mimeType: 'application/pdf',
      originalFilename: 'scan.jpg',
    });
  });

  it('stores the type it sniffed, not the one the client declared', async () => {
    const form = new FormData();
    form.append('file', new File([PNG], 'lie.jpg', { type: 'image/jpeg' }));

    const response = await POST(
      new Request('http://test/api/documents', { method: 'POST', body: form }),
    );

    expect(response.status).toBe(201);
    expect(mocks.recordDocument.mock.calls[0]?.[0]).toMatchObject({
      mimeType: 'image/png',
      originalFilename: 'lie.jpg',
    });
  });

  it('rejects a body with no file part', async () => {
    const form = new FormData();
    form.append('notAFile', 'x');

    const response = await POST(
      new Request('http://test/api/documents', { method: 'POST', body: form }),
    );

    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: 'INVALID_UPLOAD' } });
    expect(mocks.recordDocument).not.toHaveBeenCalled();
  });

  it('rejects an empty file, which is a cancelled picker', async () => {
    const response = await POST(uploadRequest(new Uint8Array(0)));

    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: 'EMPTY' } });
  });

  it('rejects a file that is neither a photo nor a PDF, whatever it is called', async () => {
    const response = await POST(
      uploadRequest(new TextEncoder().encode('not an image'), 'invoice.jpg'),
    );

    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: 'UNSUPPORTED_TYPE' } });
  });

  it('rejects a file over the configured ceiling with 413', async () => {
    vi.stubEnv('STORAGE_MAX_UPLOAD_BYTES', '8');
    resetServerEnv();

    const response = await POST(uploadRequest(PNG));

    expect(response.status).toBe(413);
    expect(await body(response)).toMatchObject({ error: { code: 'TOO_LARGE' } });
  });

  it('refuses the s3 driver instead of silently writing to a local disk', async () => {
    vi.stubEnv('STORAGE_DRIVER', 's3');
    resetServerEnv();

    const response = await POST(uploadRequest(PNG));

    expect(response.status).toBe(501);
    expect(await body(response)).toMatchObject({ error: { code: 'STORAGE_DRIVER_UNSUPPORTED' } });
  });

  it('answers 503 with advice when the database is not reachable', async () => {
    const { DatabaseUnavailableError } = await import('@einv/db');
    mocks.requireActor.mockRejectedValue(
      new DatabaseUnavailableError('run pnpm db:dev, then pnpm db:migrate'),
    );

    const response = await POST(uploadRequest(PNG));

    expect(response.status).toBe(503);
    expect(await body(response)).toMatchObject({
      error: { code: 'DATABASE_UNAVAILABLE', message: 'run pnpm db:dev, then pnpm db:migrate' },
    });
  });
});
