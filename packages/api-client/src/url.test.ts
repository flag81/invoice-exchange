import { describe, expect, it } from 'vitest';

import { API_BASE_PATH, encodePathSegment, joinUrl } from './url';

describe('joinUrl', () => {
  it('joins an absolute base with a root-relative path', () => {
    expect(joinUrl('https://api.example.test', API_BASE_PATH)).toBe(
      'https://api.example.test/api/v1',
    );
  });

  it('normalises duplicate and trailing slashes', () => {
    expect(joinUrl('https://api.example.test//', '//api/v1/', 'invoices/')).toBe(
      'https://api.example.test/api/v1/invoices',
    );
  });

  it('keeps root-relative bases root-relative', () => {
    expect(joinUrl(API_BASE_PATH, 'invoices', '123')).toBe('/api/v1/invoices/123');
  });

  it('keeps relative bases relative', () => {
    expect(joinUrl('api/v1', 'invoices')).toBe('api/v1/invoices');
  });

  it('ignores empty segments so optional parts can be passed inline', () => {
    expect(joinUrl('https://api.example.test', API_BASE_PATH, '', 'invoices')).toBe(
      'https://api.example.test/api/v1/invoices',
    );
  });

  it('carries the query string of the last segment that has one', () => {
    expect(joinUrl('https://api.example.test', API_BASE_PATH, 'invoices?status=draft')).toBe(
      'https://api.example.test/api/v1/invoices?status=draft',
    );
  });

  it('keeps the query string of the base when no segment has one', () => {
    expect(joinUrl('https://api.example.test/api/v1?tenant=acme', 'invoices')).toBe(
      'https://api.example.test/api/v1/invoices?tenant=acme',
    );
  });

  it('lets a later segment override the base query string', () => {
    expect(joinUrl('https://api.example.test/api/v1?page=1', 'invoices?page=2')).toBe(
      'https://api.example.test/api/v1/invoices?page=2',
    );
  });

  it('supports protocol-relative bases', () => {
    expect(joinUrl('//api.example.test', API_BASE_PATH)).toBe('//api.example.test/api/v1');
  });

  it('returns the base unchanged when there is nothing to append', () => {
    expect(joinUrl('https://api.example.test')).toBe('https://api.example.test');
    expect(joinUrl(API_BASE_PATH, '')).toBe(API_BASE_PATH);
  });
});

describe('encodePathSegment', () => {
  it('encodes characters that would otherwise change the path', () => {
    expect(encodePathSegment('../../admin')).toBe('..%2F..%2Fadmin');
    expect(encodePathSegment('INV 2026/001')).toBe('INV%202026%2F001');
  });

  it('leaves ordinary ids untouched', () => {
    expect(encodePathSegment('8f4c9c1e-0d4a-4c1f-9f0e-7a2b1c3d4e5f')).toBe(
      '8f4c9c1e-0d4a-4c1f-9f0e-7a2b1c3d4e5f',
    );
  });

  it('keeps an encoded id inside a single segment', () => {
    expect(joinUrl(API_BASE_PATH, 'invoices', encodePathSegment('a/b'))).toBe(
      '/api/v1/invoices/a%2Fb',
    );
  });
});
