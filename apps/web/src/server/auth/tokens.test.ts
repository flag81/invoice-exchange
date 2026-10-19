import { describe, expect, it } from 'vitest';

import { constantTimeEquals, randomToken, sha256Hex } from './tokens';

describe('randomToken', () => {
  it('is 32 bytes of entropy as 43 url-safe characters — small enough for a cookie, too big to guess', () => {
    const token = randomToken();

    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never repeats, because two equal tokens would be two people sharing a session', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));

    expect(tokens.size).toBe(200);
  });
});

describe('sha256Hex', () => {
  it('is the plain hex SHA-256 of the value — the form `sessions.token_hash` stores', () => {
    // The published digest of "abc": the one vector every SHA-256 implementation is checked against.
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is stable, so a session created by one request can be found by the next', () => {
    expect(sha256Hex('token')).toBe(sha256Hex('token'));
  });

  it('is not the token, so a leaked hash cannot be replayed as a cookie', () => {
    expect(sha256Hex('token')).not.toBe('token');
  });
});

describe('constantTimeEquals', () => {
  it('accepts two identical non-empty values', () => {
    expect(constantTimeEquals('state-abc', 'state-abc')).toBe(true);
  });

  it('refuses a one-character difference', () => {
    expect(constantTimeEquals('state-abc', 'state-abd')).toBe(false);
  });

  it('refuses different lengths rather than letting timingSafeEqual throw', () => {
    expect(constantTimeEquals('state-abc', 'state-abc-')).toBe(false);
  });

  it('refuses two empty values: an absent state must not match an absent state', () => {
    expect(constantTimeEquals('', '')).toBe(false);
  });
});
