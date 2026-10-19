import { describe, expect, it } from 'vitest';

import { captureSourceLabel, count, sq, statusLabel } from './sq';

describe('Albanian labels', () => {
  it('translates a status without changing the stored value', () => {
    expect(statusLabel('DRAFT')).toBe('Skicë');
    expect(statusLabel('PAID')).toBe('Paguar');
  });

  it('shows a status it does not know as it arrived, rather than hiding it', () => {
    expect(statusLabel('ARCHIVED')).toBe('ARCHIVED');
  });

  it('turns a capture source into a phrase the page can append', () => {
    expect(captureSourceLabel('CAMERA')).toBe('kapur me kamerë');
    expect(captureSourceLabel('UPLOAD')).toBe('ngarkuar nga një skedar');
    expect(captureSourceLabel('MANUAL')).toBe('shtuar me dorë');
    expect(captureSourceLabel('FAX')).toBe('kapur (FAX)');
  });

  it('uses the singular for exactly one', () => {
    expect(count(1, 'rresht', 'rreshta')).toBe('1 rresht');
    expect(count(0, 'rresht', 'rreshta')).toBe('0 rreshta');
    expect(count(3, 'rresht', 'rreshta')).toBe('3 rreshta');
  });

  it('names the search result count in the same grammar as the unfiltered list', () => {
    expect(sq.invoices.searchSummary('kafe', 1)).toBe('“kafe” · 1 faturë');
    expect(sq.invoices.searchSummary('kafe', 3)).toBe('“kafe” · 3 fatura');
  });
});
