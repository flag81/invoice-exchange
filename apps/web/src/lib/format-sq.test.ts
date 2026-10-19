import { describe, expect, it } from 'vitest';

import { formatDateSq } from './format-sq';

describe('formatDateSq', () => {
  it('writes an ISO calendar day the way this market reads it', () => {
    expect(formatDateSq('2026-03-14')).toBe('14.03.2026');
    expect(formatDateSq('2026-01-05')).toBe('05.01.2026');
    expect(formatDateSq('2026-12-31')).toBe('31.12.2026');
  });

  it('leaves a value it cannot read exactly as it arrived', () => {
    expect(formatDateSq('')).toBe('');
    expect(formatDateSq('14.03.2026')).toBe('14.03.2026');
    expect(formatDateSq('2026-3-14')).toBe('2026-3-14');
    expect(formatDateSq('2026-03-14T10:00:00Z')).toBe('2026-03-14T10:00:00Z');
    expect(formatDateSq('nuk është datë')).toBe('nuk është datë');
  });

  it('refuses an impossible month or day instead of reordering it', () => {
    expect(formatDateSq('2026-13-01')).toBe('2026-13-01');
    expect(formatDateSq('2026-00-10')).toBe('2026-00-10');
    expect(formatDateSq('2026-05-00')).toBe('2026-05-00');
    expect(formatDateSq('2026-05-32')).toBe('2026-05-32');
  });
});
