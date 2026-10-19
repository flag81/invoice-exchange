import { describe, expect, it } from 'vitest';

import {
  extractionSourceLabel,
  formatExtractionDuration,
  isDemoExtraction,
  toExtractionSource,
} from './extraction-source';

describe('toExtractionSource', () => {
  it('reads the three fields the extraction endpoint reports', () => {
    expect(
      toExtractionSource({ provider: 'gemini', model: 'gemini-2.5-flash', durationMs: 3421 }),
    ).toEqual({ provider: 'gemini', model: 'gemini-2.5-flash', durationMs: 3421 });
  });

  it('trims what it reads and drops a blank model or an impossible duration', () => {
    expect(toExtractionSource({ provider: ' stub ', model: '  ', durationMs: -1 })).toEqual({
      provider: 'stub',
      model: null,
      durationMs: null,
    });
    expect(toExtractionSource({ provider: 'gemini', model: null })).toEqual({
      provider: 'gemini',
      model: null,
      durationMs: null,
    });
  });

  it('answers null rather than guessing when the response says nothing usable', () => {
    expect(toExtractionSource(null)).toBeNull();
    expect(toExtractionSource('gemini')).toBeNull();
    expect(toExtractionSource({})).toBeNull();
    expect(toExtractionSource({ provider: '   ' })).toBeNull();
    expect(toExtractionSource({ provider: 42 })).toBeNull();
    expect(toExtractionSource({ provider: 'gemini', durationMs: Number.NaN })).toEqual({
      provider: 'gemini',
      model: null,
      durationMs: null,
    });
  });
});

describe('isDemoExtraction', () => {
  it('names the fixture provider, whatever case it arrives in', () => {
    expect(isDemoExtraction('stub')).toBe(true);
    expect(isDemoExtraction('  Stub ')).toBe(true);
  });

  it('treats a real reader — and an absent answer — as not a demo', () => {
    expect(isDemoExtraction('gemini')).toBe(false);
    expect(isDemoExtraction(null)).toBe(false);
    expect(isDemoExtraction(undefined)).toBe(false);
    expect(isDemoExtraction('')).toBe(false);
  });
});

describe('extractionSourceLabel', () => {
  it('names the provider with its model when it has one', () => {
    expect(extractionSourceLabel('gemini', 'gemini-2.5-flash')).toBe('gemini (gemini-2.5-flash)');
  });

  it('does not invent a model for a provider that has none', () => {
    expect(extractionSourceLabel('stub', null)).toBe('stub');
    expect(extractionSourceLabel('stub', '  ')).toBe('stub');
  });

  it('still says something for an empty name, rather than an empty sentence', () => {
    expect(extractionSourceLabel('   ', null)).toBe('?');
  });
});

describe('formatExtractionDuration', () => {
  it('uses milliseconds below a second and seconds above it', () => {
    expect(formatExtractionDuration(0)).toBe('0 ms');
    expect(formatExtractionDuration(820)).toBe('820 ms');
    expect(formatExtractionDuration(999)).toBe('999 ms');
    expect(formatExtractionDuration(3421)).toBe('3,4 s');
  });

  it('writes the decimal with a comma, the way this market reads numbers', () => {
    expect(formatExtractionDuration(12_500)).toBe('12,5 s');
  });

  it('answers null when there is no honest duration to print', () => {
    expect(formatExtractionDuration(null)).toBeNull();
    expect(formatExtractionDuration(-1)).toBeNull();
    expect(formatExtractionDuration(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
