import { describe, expect, it } from 'vitest';

import { isIsoCalendarDate, parseInvoiceDate } from './dates';

describe('parseInvoiceDate', () => {
  it('keeps an ISO date exactly as printed — a calendar day, not an instant', () => {
    expect(parseInvoiceDate('2026-03-14')).toBe('2026-03-14');
    expect(parseInvoiceDate('2026-3-4')).toBe('2026-03-04');
    expect(parseInvoiceDate('  2026-03-14  ')).toBe('2026-03-14');
  });

  it('reads the day-first formats Kosovo actually prints', () => {
    expect(parseInvoiceDate('14.03.2026')).toBe('2026-03-14');
    expect(parseInvoiceDate('14/03/2026')).toBe('2026-03-14');
    expect(parseInvoiceDate('14-03-2026')).toBe('2026-03-14');
    expect(parseInvoiceDate('4.3.2026')).toBe('2026-03-04');
  });

  it('is day-first, not month-first, for ambiguous input', () => {
    // The one place a US-style date would silently become another day; documented in the module.
    expect(parseInvoiceDate('03/04/2026')).toBe('2026-04-03');
  });

  it('validates the calendar instead of rolling over into the next month', () => {
    expect(parseInvoiceDate('2026-02-30')).toBeNull();
    expect(parseInvoiceDate('2026-13-01')).toBeNull();
    expect(parseInvoiceDate('2026-00-10')).toBeNull();
    expect(parseInvoiceDate('2026-04-31')).toBeNull();
    expect(parseInvoiceDate('2026-03-00')).toBeNull();
  });

  it('knows which Februaries have 29 days', () => {
    expect(parseInvoiceDate('2024-02-29')).toBe('2024-02-29');
    expect(parseInvoiceDate('2025-02-29')).toBeNull();
    expect(parseInvoiceDate('2000-02-29')).toBe('2000-02-29');
    expect(parseInvoiceDate('1900-02-29')).toBeNull();
  });

  it('refuses years outside the range invoice software may store', () => {
    expect(parseInvoiceDate('1899-12-31')).toBeNull();
    expect(parseInvoiceDate('3000-01-01')).toBeNull();
  });

  it('returns null for text it cannot read rather than guessing a date', () => {
    expect(parseInvoiceDate(null)).toBeNull();
    expect(parseInvoiceDate(undefined)).toBeNull();
    expect(parseInvoiceDate('')).toBeNull();
    expect(parseInvoiceDate('tomorrow')).toBeNull();
    expect(parseInvoiceDate('March 14, 2026')).toBeNull();
    expect(parseInvoiceDate('2026-03')).toBeNull();
  });
});

describe('isIsoCalendarDate', () => {
  it('accepts the shape this module produces and rejects the rest', () => {
    expect(isIsoCalendarDate('2026-03-14')).toBe(true);
    expect(isIsoCalendarDate('14.03.2026')).toBe(true);
    expect(isIsoCalendarDate('2026-02-30')).toBe(false);
    expect(isIsoCalendarDate('14. März 2026')).toBe(false);
  });
});
