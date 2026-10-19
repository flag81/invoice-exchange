import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

type Check = { name: string; status: 'pass' | 'warn' | 'fail'; detail: string };

type ReadyBody = { status: string; checks: Check[] };

const VALID_DATABASE_URL = 'postgresql://app:s3cret@127.0.0.1:5432/invoice_exchange?schema=public';

const checkNamed = (body: ReadyBody, name: string): Check | undefined =>
  body.checks.find((check) => check.name === name);

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', '');
  // The reader is part of the response: pin it so an ambient GEMINI_API_KEY cannot change a result.
  vi.stubEnv('AI_PROVIDER', 'stub');
  vi.stubEnv('GEMINI_API_KEY', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/ready', () => {
  it('is degraded (503) while DATABASE_URL is unset, and says which dependency is missing', async () => {
    const response = await GET();
    const body = (await response.json()) as ReadyBody;

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.status).toBe('degraded');
    expect(checkNamed(body, 'env')?.status).toBe('pass');
    expect(checkNamed(body, 'database')?.status).toBe('fail');
    expect(checkNamed(body, 'database')?.detail).toContain('DATABASE_URL is not set');
  });

  it('is ready (200) for a well-formed PostgreSQL URL and reports the target without credentials', async () => {
    vi.stubEnv('DATABASE_URL', VALID_DATABASE_URL);

    const response = await GET();
    const body = (await response.json()) as ReadyBody;
    const database = checkNamed(body, 'database');

    expect(response.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(database?.status).toBe('pass');
    expect(database?.detail).toContain('postgresql://127.0.0.1:5432/invoice_exchange');
    expect(database?.detail).not.toContain('s3cret');
    expect(database?.detail).not.toContain('app:');
  });

  it('is degraded when DATABASE_URL points at a non-PostgreSQL server', async () => {
    vi.stubEnv('DATABASE_URL', 'mysql://root@127.0.0.1:3306/invoice_exchange');

    const response = await GET();
    const body = (await response.json()) as ReadyBody;

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(checkNamed(body, 'database')?.detail).toContain('postgresql://');
  });

  it('is degraded, and blames the environment, when a value is invalid', async () => {
    vi.stubEnv('APP_URL', 'not-a-url');
    vi.stubEnv('DATABASE_URL', VALID_DATABASE_URL);

    const response = await GET();
    const body = (await response.json()) as ReadyBody;

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(checkNamed(body, 'env')?.status).toBe('fail');
    expect(checkNamed(body, 'env')?.detail).toContain('APP_URL');
    expect(checkNamed(body, 'database')?.detail).toContain('skipped');
  });

  it('reports every check exactly once', async () => {
    const body = (await (await GET()).json()) as ReadyBody;

    expect(body.checks.map((check) => check.name)).toEqual(['env', 'database', 'extraction']);
  });

  it('stays ready but warns that the stub invents the numbers', async () => {
    vi.stubEnv('DATABASE_URL', VALID_DATABASE_URL);

    const response = await GET();
    const body = (await response.json()) as ReadyBody;
    const extraction = checkNamed(body, 'extraction');

    expect(response.status).toBe(200);
    expect(extraction?.status).toBe('warn');
    expect(extraction?.detail).toContain('demo fixture');
  });

  it('fails when the reader is Gemini but its key is missing', async () => {
    vi.stubEnv('DATABASE_URL', VALID_DATABASE_URL);
    vi.stubEnv('AI_PROVIDER', 'gemini');

    const response = await GET();
    const body = (await response.json()) as ReadyBody;

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(checkNamed(body, 'extraction')?.status).toBe('fail');
    expect(checkNamed(body, 'extraction')?.detail).toContain('GEMINI_API_KEY');
  });

  it('passes when a key is configured, and names the model that will read', async () => {
    vi.stubEnv('DATABASE_URL', VALID_DATABASE_URL);
    vi.stubEnv('AI_PROVIDER', '');
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    vi.stubEnv('GEMINI_MODEL', 'gemini-test');

    const response = await GET();
    const body = (await response.json()) as ReadyBody;

    expect(response.status).toBe(200);
    expect(checkNamed(body, 'extraction')?.status).toBe('pass');
    expect(checkNamed(body, 'extraction')?.detail).toBe('gemini (gemini-test)');
    // The key itself is a secret: it must never reach the probe's response.
    expect(JSON.stringify(body)).not.toContain('test-key');
  });

  it('skips the reader when the environment itself is invalid', async () => {
    vi.stubEnv('APP_URL', 'not-a-url');
    vi.stubEnv('DATABASE_URL', VALID_DATABASE_URL);

    const body = (await (await GET()).json()) as ReadyBody;

    expect(checkNamed(body, 'extraction')?.status).toBe('fail');
    expect(checkNamed(body, 'extraction')?.detail).toContain('skipped');
  });
});
