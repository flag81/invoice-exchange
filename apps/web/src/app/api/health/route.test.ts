import { describe, expect, it } from 'vitest';

import { APP_NAME, APP_VERSION } from '@/lib/app-meta';

import { GET } from './route';

describe('GET /api/health', () => {
  it('reports the process as alive without touching any dependency', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');

    const body = (await response.json()) as Record<string, unknown>;

    expect(body.status).toBe('ok');
    expect(body.service).toBe(APP_NAME);
    expect(body.version).toBe(APP_VERSION);
    expect(body.environment).toBe(process.env.NODE_ENV);
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(Number.isNaN(Date.parse(String(body.timestamp)))).toBe(false);
  });

  it('stays 200 even when the environment is misconfigured, because liveness is not readiness', async () => {
    const response = await GET();

    // The handler must not read the validated environment: a bad APP_URL is a readiness failure.
    expect(response.status).toBe(200);
  });
});
