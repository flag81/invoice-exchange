import { describe, expect, it } from 'vitest';

import { safeReturnTo, signInErrorPath, signInPath } from './return-to';

describe('safeReturnTo', () => {
  it('keeps a path on this site, query string included', () => {
    expect(safeReturnTo('/invoices/abc?tab=lines')).toBe('/invoices/abc?tab=lines');
  });

  it('falls back to the home screen for anything that is not a path here', () => {
    // Each of these has shipped as an open redirect somewhere: a scheme, a protocol-relative host, a
    // backslash that browsers normalise into one, and a percent-encoded newline that becomes a header
    // injection in a careless proxy.
    for (const attempt of [
      'https://evil.example/invoices',
      '//evil.example/invoices',
      '/\\evil.example',
      '/invoices\nX-Injected: 1',
      'invoices',
      '',
    ]) {
      expect(safeReturnTo(attempt)).toBe('/');
    }
  });

  it('treats a missing value as the home screen', () => {
    expect(safeReturnTo(null)).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
  });
});

describe('signInPath', () => {
  it('carries the wanted page in `next`', () => {
    expect(signInPath('/invoices/abc')).toBe('/signin?next=%2Finvoices%2Fabc');
  });

  it('omits `next` when landing on the home screen anyway', () => {
    expect(signInPath('/')).toBe('/signin');
    expect(signInPath()).toBe('/signin');
  });

  it('sanitises what it carries, so the sign-in page can never be an open redirect', () => {
    expect(signInPath('//evil.example')).toBe('/signin');
  });
});

describe('signInErrorPath', () => {
  it("carries the code, never the provider's prose", () => {
    expect(signInErrorPath('OAUTH_FAILED')).toBe('/signin?error=OAUTH_FAILED');
  });

  it('keeps the wanted page, so a failed attempt does not lose the invoice', () => {
    expect(signInErrorPath('OAUTH_FAILED', '/invoices/abc')).toBe(
      '/signin?error=OAUTH_FAILED&next=%2Finvoices%2Fabc',
    );
  });

  it('drops an unsafe `next` instead of forwarding it', () => {
    expect(signInErrorPath('OAUTH_FAILED', 'https://evil.example')).toBe(
      '/signin?error=OAUTH_FAILED',
    );
  });
});
