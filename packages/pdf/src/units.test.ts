import { describe, expect, it } from 'vitest';

import {
  A4_HEIGHT,
  A4_WIDTH,
  CONTENT_WIDTH,
  PAGE,
  PAGE_MARGIN,
  POINTS_PER_MILLIMETER,
  mm,
} from './units';

describe('mm', () => {
  it('converts millimetres to points', () => {
    expect(mm(1)).toBe(2.83);
    expect(mm(10)).toBe(28.35);
    expect(mm(25.4)).toBe(72);
  });

  it('rounds to 1/100 pt so coordinates stay stable across platforms', () => {
    expect(mm(1 / 3)).toBe(0.94);
    expect(mm(0)).toBe(0);
  });

  it('handles negative offsets (mirrored layouts, debug outlines)', () => {
    expect(mm(-5)).toBe(-14.17);
  });

  it('refuses non-finite input instead of producing a silently broken page', () => {
    expect(() => mm(Number.NaN)).toThrow(RangeError);
    expect(() => mm(Number.POSITIVE_INFINITY)).toThrow(/finite/i);
    expect(() => mm(Number.NEGATIVE_INFINITY)).toThrow(/finite/i);
  });

  it('exposes the conversion factor for template tests', () => {
    // Expressed from the definition of a point (72 pt = 25.4 mm) rather than a long literal:
    // a hand-copied double is both a precision hazard and a second source of truth.
    expect(POINTS_PER_MILLIMETER).toBeCloseTo(72 / 25.4, 12);
  });
});

describe('page geometry', () => {
  it('uses ISO A4 (210 × 297 mm) in points', () => {
    expect(A4_WIDTH).toBe(595.28);
    expect(A4_HEIGHT).toBe(841.89);
    expect(PAGE).toEqual({ width: A4_WIDTH, height: A4_HEIGHT });
  });

  it('keeps margins inside printable limits and symmetric horizontally', () => {
    expect(PAGE_MARGIN.left).toBe(PAGE_MARGIN.right);
    expect(PAGE_MARGIN.top).toBeGreaterThanOrEqual(mm(10));
    expect(PAGE_MARGIN.bottom).toBeGreaterThanOrEqual(mm(15));
    expect(PAGE_MARGIN.top + PAGE_MARGIN.bottom).toBeLessThan(A4_HEIGHT / 2);
  });

  it('derives a positive content width from the margins', () => {
    expect(CONTENT_WIDTH).toBe(504.58);
    expect(CONTENT_WIDTH).toBeGreaterThan(mm(150));
  });
});
