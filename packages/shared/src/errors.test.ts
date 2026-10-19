import { describe, expect, it } from 'vitest';

import { DomainError, DomainErrorCode, fail, isDomainError } from './index';

describe('DomainError', () => {
  it('carries the rule that was broken, next to log-safe details', () => {
    const error = new DomainError(DomainErrorCode.INVALID_AMOUNT, 'bad amount', {
      input: 'twelve',
      minor: 12n,
      fatal: false,
      context: null,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DomainError');
    expect(error.message).toBe('bad amount');
    expect(error.code).toBe(DomainErrorCode.INVALID_AMOUNT);
    expect(error.details).toEqual({ input: 'twelve', minor: 12n, fatal: false, context: null });
  });

  it('leaves details undefined when the rule has nothing structured to say', () => {
    expect(new DomainError(DomainErrorCode.STATE_CONFLICT, 'nope').details).toBeUndefined();
  });

  it('is recognised by isDomainError, and nothing else is', () => {
    expect(isDomainError(new DomainError(DomainErrorCode.STATE_CONFLICT, 'nope'))).toBe(true);
    expect(isDomainError(new Error('nope'))).toBe(false);
    expect(isDomainError('STATE_CONFLICT')).toBe(false);
    expect(isDomainError(null)).toBe(false);
  });
});

describe('fail', () => {
  it('throws a DomainError, so a branch that must not continue cannot continue silently', () => {
    let caught: unknown;

    try {
      fail(DomainErrorCode.REASON_REQUIRED, 'a reason is required', { action: 'DISPUTE' });
    } catch (error) {
      caught = error;
    }

    expect(isDomainError(caught)).toBe(true);
    expect((caught as DomainError).code).toBe(DomainErrorCode.REASON_REQUIRED);
    expect((caught as DomainError).details).toEqual({ action: 'DISPUTE' });
  });
});

describe('DomainErrorCode', () => {
  it('is a closed set of distinct, greppable codes', () => {
    const codes = Object.values(DomainErrorCode);

    expect(codes.length).toBeGreaterThan(5);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => code === code.toUpperCase())).toBe(true);
  });
});
