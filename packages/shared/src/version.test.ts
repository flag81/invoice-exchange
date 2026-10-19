import { describe, expect, it } from 'vitest';

import { DOMAIN_API_VERSION, DOMAIN_PACKAGE_NAME } from './index';

describe('domain package identity', () => {
  it('exposes a positive API version', () => {
    expect(DOMAIN_API_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(DOMAIN_API_VERSION)).toBe(true);
  });

  it('is published under the scoped package name used by every workspace consumer', () => {
    expect(DOMAIN_PACKAGE_NAME).toBe('@einv/shared');
    expect(DOMAIN_PACKAGE_NAME.startsWith('@einv/')).toBe(true);
  });
});
