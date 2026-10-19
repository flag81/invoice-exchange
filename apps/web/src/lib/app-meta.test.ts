import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { API_BASE_PATH, APP_NAME, APP_VERSION } from './app-meta';

type PackageJson = { name?: string; version?: string };

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as PackageJson;

describe('application identity', () => {
  it('keeps APP_VERSION in step with package.json', () => {
    expect(APP_VERSION).toBe(packageJson.version);
  });

  it('names the app and the API base path consistently', () => {
    expect(packageJson.name).toBe('@einv/web');
    expect(APP_NAME.length).toBeGreaterThan(0);
    expect(API_BASE_PATH).toBe('/api/v1');
  });
});
