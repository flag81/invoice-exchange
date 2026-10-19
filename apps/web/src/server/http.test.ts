import { DatabaseUnavailableError } from '@einv/db';
import { DomainError, DomainErrorCode } from '@einv/shared';
import { describe, expect, it, vi } from 'vitest';

import { ExtractionFailedError } from '@/server/extraction/types';
import { UnsafeStorageKeyError } from '@/server/storage/local-storage';

import {
  asRecord,
  jsonResponse,
  readEnumField,
  readJsonBody,
  readStringField,
  toErrorResponse,
} from './http';

async function readError(response: Response): Promise<{
  status: number;
  code: string;
  message: string;
  details?: unknown;
}> {
  const payload = (await response.json()) as {
    error: { code: string; message: string; details?: unknown };
  };

  return {
    status: response.status,
    code: payload.error.code,
    message: payload.error.message,
    ...(payload.error.details === undefined ? {} : { details: payload.error.details }),
  };
}

describe('toErrorResponse', () => {
  it('turns a broken rule into the 4xx the client can branch on', async () => {
    const cases: readonly (readonly [DomainErrorCode, number])[] = [
      [DomainErrorCode.INVALID_AMOUNT, 422],
      [DomainErrorCode.INVALID_INVOICE, 422],
      [DomainErrorCode.REASON_REQUIRED, 422],
      [DomainErrorCode.STATE_CONFLICT, 409],
      [DomainErrorCode.TOTALS_MISMATCH, 409],
      [DomainErrorCode.PERMISSION_DENIED, 403],
      [DomainErrorCode.DIVISION_BY_ZERO, 500],
    ];

    for (const [code, status] of cases) {
      const response = toErrorResponse(new DomainError(code, 'a rule was broken'));

      expect(response.status).toBe(status);
      await expect(readError(response)).resolves.toMatchObject({ code, status });
    }
  });

  it('renders a bigint in the details as a string, because JSON has no bigint', async () => {
    const response = toErrorResponse(
      new DomainError(DomainErrorCode.INVALID_AMOUNT, 'too big', { amount: 1234n, label: 'total' }),
    );

    await expect(readError(response)).resolves.toMatchObject({
      details: { amount: '1234', label: 'total' },
    });
  });

  it('omits details entirely when the domain error carries none', async () => {
    const payload = (await toErrorResponse(
      new DomainError(DomainErrorCode.INVALID_INVOICE, 'no details'),
    ).json()) as { error: Record<string, unknown> };

    expect('details' in payload.error).toBe(false);
  });

  it('answers 503 with the setup advice when the database is unavailable', async () => {
    const response = toErrorResponse(new DatabaseUnavailableError('DATABASE_URL is not set'));

    await expect(readError(response)).resolves.toMatchObject({
      status: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'DATABASE_URL is not set',
    });
  });

  it('answers 502 for a provider failure anywhere in the extraction path', async () => {
    const response = toErrorResponse(new ExtractionFailedError('the model did not answer'));

    await expect(readError(response)).resolves.toMatchObject({
      status: 502,
      code: 'EXTRACTION_FAILED',
    });
  });

  it('answers 400 for a storage key it would not have generated', async () => {
    const response = toErrorResponse(new UnsafeStorageKeyError('../etc/passwd'));

    await expect(readError(response)).resolves.toMatchObject({
      status: 400,
      code: 'UNSAFE_STORAGE_KEY',
    });
  });

  it('says nothing useful about an unexpected failure, but logs it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('connect ECONNREFUSED 10.0.0.1:5432');

    try {
      const response = toErrorResponse(failure);
      const error = await readError(response);

      expect(error).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
      expect(error.message).not.toContain('ECONNREFUSED');
      // The body is opaque; the operator still gets the stack, or nothing can be debugged.
      expect(logged).toHaveBeenCalledWith('[api] unhandled error', failure);
    } finally {
      logged.mockRestore();
    }
  });

  it('never lets a response be cached', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      expect(toErrorResponse(new Error('x')).headers.get('cache-control')).toBe('no-store');
    } finally {
      logged.mockRestore();
    }
  });
});

describe('jsonResponse', () => {
  it('sets the headers this API always sets', async () => {
    const response = jsonResponse({ ok: true }, 201);

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('defaults to 200', () => {
    expect(jsonResponse({}).status).toBe(200);
  });
});

describe('readJsonBody', () => {
  it('reads a JSON body', async () => {
    await expect(
      readJsonBody(new Request('http://test/api', { method: 'POST', body: '{"a":1}' })),
    ).resolves.toEqual({ a: 1 });
  });

  it('returns null for a body that is not JSON, rather than throwing at the caller', async () => {
    await expect(
      readJsonBody(new Request('http://test/api', { method: 'POST', body: 'not json' })),
    ).resolves.toBeNull();
  });
});

describe('asRecord', () => {
  it('accepts an object and refuses everything else', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord(null)).toBeNull();
    expect(asRecord([1, 2])).toBeNull();
    expect(asRecord('text')).toBeNull();
    expect(asRecord(42)).toBeNull();
  });
});

describe('readStringField', () => {
  it('trims text, accepts a number, and reports blanks as missing', () => {
    expect(readStringField({ name: '  Kafe  ' }, 'name')).toBe('Kafe');
    expect(readStringField({ quantity: 3 }, 'quantity')).toBe('3');
    expect(readStringField({ name: '   ' }, 'name')).toBeNull();
    expect(readStringField({ name: true }, 'name')).toBeNull();
    expect(readStringField({}, 'name')).toBeNull();
  });
});

describe('readEnumField', () => {
  it('takes a value from the closed set and falls back for anything else', () => {
    const allowed = ['CAMERA', 'UPLOAD'] as const;

    expect(readEnumField({ source: 'CAMERA' }, 'source', allowed, 'UPLOAD')).toBe('CAMERA');
    expect(readEnumField({ source: 'TELEPATHY' }, 'source', allowed, 'UPLOAD')).toBe('UPLOAD');
    expect(readEnumField({}, 'source', allowed, 'UPLOAD')).toBe('UPLOAD');
  });
});
