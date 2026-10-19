import { CurrencyCode, TaxCategory, normaliseExtractedInvoice, type TaxRate } from '@einv/shared';
import { describe, expect, it, vi } from 'vitest';

import { parseServerEnv } from '@/lib/env';

import { describeProvider, selectExtractionProvider } from './index';
import { createStubProvider, digestOf, stubInvoiceFromDigest } from './stub';
import { runProvider, type ExtractionProvider } from './types';

/** The rate table the seed creates, in the shape the domain uses. */
const tenantRates: readonly TaxRate[] = [
  { id: 'vat-18', name: 'TVSH 18%', category: TaxCategory.STANDARD, ratePercent: '18' },
  { id: 'vat-8', name: 'TVSH 8%', category: TaxCategory.REDUCED, ratePercent: '8' },
];

const digest = 'a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7f809';

describe('the stub provider', () => {
  it('derives the same invoice from the same bytes, every time', () => {
    expect(stubInvoiceFromDigest(digest)).toEqual(stubInvoiceFromDigest(digest));
  });

  it('derives a different document from different bytes, so a demo is not obviously canned', () => {
    const first = stubInvoiceFromDigest(digest);
    const second = stubInvoiceFromDigest(
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    );

    expect(first['invoiceNumber']).not.toBe(second['invoiceNumber']);
  });

  it('digests the bytes the way the storage layer does', () => {
    expect(digestOf(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('produces a draft the domain accepts, with nothing to report', async () => {
    const provider = createStubProvider();
    const result = await provider.extract({
      bytes: Uint8Array.of(1, 2, 3, 4, 5),
      mimeType: 'image/png',
      filename: 'invoice.png',
    });

    const draft = normaliseExtractedInvoice(result.raw, {
      defaultCurrency: CurrencyCode.EUR,
      taxRates: tenantRates,
    });

    expect(result.provider).toBe('stub');
    expect(result.model).toBe('stub-1');
    expect(draft.isSaveable).toBe(true);
    expect(draft.problems).toEqual([]);
    expect(draft.lines.length).toBeGreaterThan(0);
    expect(draft.supplier.name).not.toBeNull();
    expect(draft.currency).toBe(CurrencyCode.EUR);
    expect(draft.notes).toContain('stub extraction provider');
  });
});

describe('runProvider', () => {
  it('carries the provider and the model onto the result the caller stores', async () => {
    const provider: ExtractionProvider = {
      name: 'test',
      model: 'test-1',
      extract: () =>
        Promise.resolve({ raw: { ok: true }, provider: 'test', model: 'test-1', durationMs: 7 }),
    };

    await expect(
      runProvider(provider, { bytes: Uint8Array.of(1), mimeType: 'image/png' }),
    ).resolves.toMatchObject({ provider: 'test', model: 'test-1', durationMs: 7 });
  });

  it('measures the duration itself when the provider does not report one', async () => {
    const provider: ExtractionProvider = {
      name: 'greedy',
      model: null,
      extract: () => Promise.resolve({ raw: {}, provider: 'greedy', model: null, durationMs: 0 }),
    };

    const result = await runProvider(provider, { bytes: Uint8Array.of(1), mimeType: 'image/png' });

    expect(result.durationMs).toBe(0);
  });
});

describe('selectExtractionProvider', () => {
  it('obeys an explicit choice', () => {
    const stub = selectExtractionProvider(parseServerEnv({ AI_PROVIDER: 'stub' }));

    expect(stub.name).toBe('stub');
    expect(describeProvider(stub)).toBe('stub (stub-1)');
  });

  it('refuses to pretend when Gemini is asked for without a key', () => {
    expect(() => selectExtractionProvider(parseServerEnv({ AI_PROVIDER: 'gemini' }))).toThrowError(
      /GEMINI_API_KEY është bosh/,
    );
  });

  it('uses the stub when nothing is configured, so a fresh clone runs', () => {
    expect(selectExtractionProvider(parseServerEnv({})).name).toBe('stub');
  });

  it('uses Gemini when a key is present and no provider was named', () => {
    const provider = selectExtractionProvider(
      parseServerEnv({ GEMINI_API_KEY: 'key', GEMINI_MODEL: 'gemini-test' }),
    );

    expect(provider.name).toBe('gemini');
    expect(describeProvider(provider)).toBe('gemini (gemini-test)');
  });

  it('describes a provider with no model by its name alone', () => {
    expect(describeProvider({ name: 'x', model: null, extract: vi.fn() })).toBe('x');
  });
});
