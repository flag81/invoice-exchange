import { describe, expect, it } from 'vitest';

import { AuthError, AuthErrorCode } from './errors';
import { assertSameOrigin, configuredOrigin, isMutatingMethod, originVerdict } from './origin';

const APP_URL = 'https://app.example.test';

function headers(init: Record<string, string> = {}): Headers {
  return new Headers(init);
}

describe('originVerdict', () => {
  it("accepts the deployment's own origin", () => {
    expect(originVerdict(headers({ origin: APP_URL }), APP_URL)).toBe('same-origin');
  });

  it('refuses any other origin, including one that merely starts the same', () => {
    expect(originVerdict(headers({ origin: 'https://evil.example' }), APP_URL)).toBe(
      'cross-origin',
    );
    expect(originVerdict(headers({ origin: `${APP_URL}.evil.example` }), APP_URL)).toBe(
      'cross-origin',
    );
  });

  it('refuses everything when APP_URL itself is unparseable — a broken config must not open the gate', () => {
    expect(configuredOrigin('not a url')).toBeNull();
    expect(originVerdict(headers({ origin: APP_URL }), 'not a url')).toBe('cross-origin');
  });

  it('reads Sec-Fetch-Site when there is no Origin, and accepts only a same-site navigation', () => {
    expect(originVerdict(headers({ 'sec-fetch-site': 'same-origin' }), APP_URL)).toBe(
      'same-origin',
    );
    expect(originVerdict(headers({ 'sec-fetch-site': 'none' }), APP_URL)).toBe('same-origin');
    expect(originVerdict(headers({ 'sec-fetch-site': 'cross-site' }), APP_URL)).toBe(
      'cross-origin',
    );
    expect(originVerdict(headers({ 'sec-fetch-site': 'same-site' }), APP_URL)).toBe('cross-origin');
  });

  it('calls a request with neither header a non-browser client', () => {
    // curl and the mobile app send no automatic cookies, so CSRF has nothing to attach to.
    expect(originVerdict(headers(), APP_URL)).toBe('not-a-browser');
  });

  it('ignores an empty header, which some proxies produce', () => {
    expect(originVerdict(headers({ origin: '' }), APP_URL)).toBe('not-a-browser');
  });
});

describe('isMutatingMethod', () => {
  it('treats the four state-changing verbs as mutations', () => {
    for (const method of ['POST', 'put', 'PATCH', 'delete']) {
      expect(isMutatingMethod(method)).toBe(true);
    }
  });

  it('treats reads and HEAD as safe', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(isMutatingMethod(method)).toBe(false);
    }
  });
});

describe('assertSameOrigin', () => {
  it('lets a cross-origin GET through: it cannot change anything', () => {
    const request = new Request('http://test/api/invoices', {
      headers: { origin: 'https://evil.example' },
    });

    expect(() => {
      assertSameOrigin(request, APP_URL);
    }).not.toThrow();
  });

  it('refuses a cross-origin POST with CROSS_ORIGIN, which the HTTP layer maps to 403', () => {
    const request = new Request('http://test/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    });

    expect.assertions(2);

    try {
      assertSameOrigin(request, APP_URL);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe(AuthErrorCode.CROSS_ORIGIN);
    }
  });

  it('lets a form post from the page itself through, and a call with no headers at all', () => {
    expect(() => {
      assertSameOrigin(
        new Request('http://test/api/auth/logout', {
          method: 'POST',
          headers: { origin: APP_URL },
        }),
        APP_URL,
      );
      assertSameOrigin(new Request('http://test/api/auth/logout', { method: 'POST' }), APP_URL);
    }).not.toThrow();
  });
});
