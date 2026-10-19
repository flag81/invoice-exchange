import { describe, expect, it } from 'vitest';

import { describeDatabaseUrl, redactDatabaseUrl } from './dsn';

describe('redactDatabaseUrl', () => {
  it('masks the password of a standard postgres URL', () => {
    expect(redactDatabaseUrl('postgresql://alice:s3cret@db.internal:5432/invoices')).toBe(
      'postgresql://alice:***@db.internal:5432/invoices',
    );
  });

  it('keeps the schema parameter and drops everything else', () => {
    const redacted = redactDatabaseUrl(
      'postgresql://alice:s3cret@localhost:5432/invoices?schema=public&password=oops&sslmode=require',
    );

    expect(redacted).toBe('postgresql://alice:***@localhost:5432/invoices?schema=public');
    expect(redacted).not.toContain('s3cret');
    expect(redacted).not.toContain('oops');
  });

  it('handles URLs without credentials', () => {
    expect(redactDatabaseUrl('postgresql://localhost:5432/invoices')).toBe(
      'postgresql://localhost:5432/invoices',
    );
  });

  it('decodes percent-encoded usernames so the log line stays readable', () => {
    expect(redactDatabaseUrl('postgresql://user%40corp:pw@localhost:5432/db')).toBe(
      'postgresql://user@corp:***@localhost:5432/db',
    );
  });

  it('never throws on malformed input', () => {
    expect(redactDatabaseUrl('not-a-url')).toBe('<invalid-database-url>');
    expect(redactDatabaseUrl('')).toBe('<invalid-database-url>');
  });

  it('preserves non-postgres schemes so misconfiguration is visible', () => {
    expect(redactDatabaseUrl('mysql://root:pw@localhost:3306/app')).toBe(
      'mysql://root:***@localhost:3306/app',
    );
  });
});

describe('describeDatabaseUrl', () => {
  it('extracts the structural parts used by health checks', () => {
    expect(
      describeDatabaseUrl('postgresql://alice:pw@db.internal:5432/invoices?schema=public'),
    ).toEqual({
      protocol: 'postgresql',
      host: 'db.internal',
      port: '5432',
      database: 'invoices',
      schema: 'public',
      user: 'alice',
    });
  });

  it('reports nulls for the parts that are absent', () => {
    expect(describeDatabaseUrl('postgresql://localhost/invoices')).toEqual({
      protocol: 'postgresql',
      host: 'localhost',
      port: null,
      database: 'invoices',
      schema: null,
      user: null,
    });
  });

  it('reports an invalid target instead of throwing', () => {
    expect(describeDatabaseUrl('://')).toEqual({
      protocol: 'unknown',
      host: '<invalid>',
      port: null,
      database: null,
      schema: null,
      user: null,
    });
  });
});
