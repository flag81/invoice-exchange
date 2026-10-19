import { describe, expect, it, vi } from 'vitest';

import {
  buildGeminiBody,
  extractWithGemini,
  geminiEndpoint,
  parseGeminiAnswer,
  stripCodeFence,
} from './gemini';
import { ExtractionFailedError } from './types';

const answer = (text: string): Response =>
  Response.json({ candidates: [{ content: { parts: [{ text }] } }] });

describe('geminiEndpoint', () => {
  it('puts the model in the path and never the key in the query string', () => {
    expect(geminiEndpoint('gemini-2.5-flash')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    expect(geminiEndpoint('gemini 2.5/flash')).not.toContain(' ');
  });
});

describe('buildGeminiBody', () => {
  it('sends the image inline, base64-encoded, with the instruction and JSON mode', () => {
    const body = buildGeminiBody({
      bytes: new TextEncoder().encode('abc'),
      mimeType: 'image/jpeg',
    });

    const parts = body.contents[0]?.parts ?? [];

    expect(parts[0]).toEqual({
      inline_data: { mime_type: 'image/jpeg', data: Buffer.from('abc').toString('base64') },
    });
    expect(JSON.stringify(parts[1])).toContain('supplierVatNumber');
    expect(body.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      temperature: 0,
    });
  });

  it('sends a PDF the same way, so the model reads the pages itself', () => {
    const body = buildGeminiBody({
      bytes: new TextEncoder().encode('%PDF-1.7'),
      mimeType: 'application/pdf',
    });

    expect(body.contents[0]?.parts[0]).toEqual({
      inline_data: {
        mime_type: 'application/pdf',
        data: Buffer.from('%PDF-1.7').toString('base64'),
      },
    });
    expect(JSON.stringify(body.contents[0]?.parts[1])).toContain('every page');
  });
});

describe('stripCodeFence', () => {
  it('removes the fence a model adds even in JSON mode', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });
});

describe('parseGeminiAnswer', () => {
  it('reads the JSON out of a candidates payload', () => {
    const payload = { candidates: [{ content: { parts: [{ text: '{"supplierName":"Kafe"}' }] } }] };

    expect(parseGeminiAnswer(payload)).toEqual({ supplierName: 'Kafe' });
  });

  it('joins a multi-part answer and ignores parts that are not text', () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [{ text: '{"supplier' }, { inline_data: {} }, { text: 'Name":"Kafe"}' }],
          },
        },
      ],
    };

    expect(parseGeminiAnswer(payload)).toEqual({ supplierName: 'Kafe' });
  });

  it('fails with a named error when the model returns nothing at all', () => {
    expect(() => parseGeminiAnswer({ candidates: [] })).toThrowError(ExtractionFailedError);
    expect(() => parseGeminiAnswer(null)).toThrowError(/nuk ktheu përmbajtje/);
    expect(() => parseGeminiAnswer({ candidates: [{}] })).toThrowError(/nuk ktheu përmbajtje/);
    expect(() =>
      parseGeminiAnswer({ candidates: [{ content: { parts: [{ text: '  ' }] } }] }),
    ).toThrowError(/nuk ktheu përmbajtje/);
  });

  it('fails with the offending text when the answer is not JSON', () => {
    const payload = {
      candidates: [{ content: { parts: [{ text: 'I cannot read this image' }] } }],
    };

    expect(() => parseGeminiAnswer(payload)).toThrowError(/nuk u përgjigj me JSON/);
  });
});

describe('extractWithGemini', () => {
  it('calls the endpoint with the key in a header, and returns the parsed answer', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(answer('{"supplierName":"Kafe"}'));

    const result = await extractWithGemini(
      { bytes: Uint8Array.of(1), mimeType: 'image/png' },
      { apiKey: 'secret-key', model: 'gemini-2.5-flash', fetchImpl },
    );

    expect(result.raw).toEqual({ supplierName: 'Kafe' });
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-2.5-flash');

    const [url, init] = fetchImpl.mock.calls[0] ?? [];

    expect(String(url)).not.toContain('secret-key');
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('secret-key');
  });

  it('reports a non-2xx answer with its status, so an operator can tell 400 from 429', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('quota exceeded', { status: 429 }));

    await expect(
      extractWithGemini(
        { bytes: Uint8Array.of(1), mimeType: 'image/png' },
        { apiKey: 'k', model: 'm', fetchImpl },
      ),
    ).rejects.toThrowError(/u përgjigj 429/);
  });

  it('reports a timeout as a timeout, not as a mystery', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(timeout);

    await expect(
      extractWithGemini(
        { bytes: Uint8Array.of(1), mimeType: 'image/png' },
        { apiKey: 'k', model: 'm', fetchImpl, timeoutMs: 10 },
      ),
    ).rejects.toThrowError(/skadoi \(modeli m, afati 10 ms\)/);
  });

  it('reports a network failure as a failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      extractWithGemini(
        { bytes: Uint8Array.of(1), mimeType: 'image/png' },
        { apiKey: 'k', model: 'm', fetchImpl },
      ),
    ).rejects.toThrowError(/nxjerrje dështoi/);
  });
});
