import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseServerEnv, publicEnv, serverEnv } from './env';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('parseServerEnv', () => {
  it('applies development defaults for an otherwise empty environment', () => {
    const env = parseServerEnv({});

    expect(env.NODE_ENV).toBe('development');
    expect(env.APP_URL).toBe('http://localhost:3001');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(env.STORAGE_LOCAL_ROOT).toBe('.devdata/storage');
    expect(env.MAIL_FROM).toBe('invoices@example.test');
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.SMTP_URL).toBeUndefined();
  });

  it('treats empty strings as unset, so a copied .env.example boots', () => {
    const env = parseServerEnv({ DATABASE_URL: '', SMTP_URL: '   ', TEST_DATABASE_URL: '' });

    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.TEST_DATABASE_URL).toBeUndefined();
  });

  it('parses a realistic production environment', () => {
    const env = parseServerEnv({
      NODE_ENV: 'production',
      APP_URL: 'https://invoices.example.test',
      LOG_LEVEL: 'warn',
      DATABASE_URL: 'postgresql://app:secret@db.internal:5432/invoices?schema=public',
      STORAGE_DRIVER: 's3',
      SMTP_URL: 'smtp://user:password@smtp.example.test:587',
      MAIL_FROM: 'billing@example.test',
    });

    expect(env.NODE_ENV).toBe('production');
    expect(env.APP_URL).toBe('https://invoices.example.test');
    expect(env.LOG_LEVEL).toBe('warn');
    expect(env.STORAGE_DRIVER).toBe('s3');
    expect(env.DATABASE_URL).toContain('db.internal');
  });

  it('ignores unrelated variables, because a real process.env has hundreds', () => {
    expect(() =>
      parseServerEnv({ PATH: 'C:\\Windows', HOME: '/root', npm_lifecycle_event: 'test' }),
    ).not.toThrow();
  });

  it('rejects a malformed APP_URL and names the key', () => {
    expect(() => parseServerEnv({ APP_URL: 'not-a-url' })).toThrow(/APP_URL/);
  });

  it('rejects an unknown log level and names the key', () => {
    expect(() => parseServerEnv({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });

  it('rejects an unknown storage driver instead of silently using the local one', () => {
    expect(() => parseServerEnv({ STORAGE_DRIVER: 'gcs' })).toThrow(/STORAGE_DRIVER/);
  });

  it('reports every problem at once rather than the first one', () => {
    expect(() => parseServerEnv({ APP_URL: 'nope', LOG_LEVEL: 'loud' })).toThrow(
      /APP_URL[\s\S]*LOG_LEVEL/,
    );
  });

  it('rejects an unknown NODE_ENV rather than defaulting it', () => {
    expect(() => parseServerEnv({ NODE_ENV: 'prod' })).toThrow(/NODE_ENV/);
  });
});

describe('serverEnv', () => {
  it('memoises the parsed process environment', () => {
    const first = serverEnv();
    const second = serverEnv();

    expect(first).toBe(second);
    expect(first.NODE_ENV).toBe(process.env.NODE_ENV);
  });
});

describe('publicEnv', () => {
  it('exposes the browser-safe subset and nothing else', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://invoices.example.test');

    const values = Object.values(publicEnv);

    expect(Object.keys(publicEnv)).toEqual(['appUrl', 'nodeEnv']);
    expect(values.every((value) => typeof value === 'string')).toBe(true);
  });
});
