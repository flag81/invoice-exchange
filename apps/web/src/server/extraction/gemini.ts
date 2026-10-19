/**
 * Gemini — the default extraction provider (§12, D6: provider-agnostic interface, Gemini first).
 *
 * Three decisions worth stating, because they are the ones that bite in production:
 *
 *   1. **The API key travels in a header, not in the URL.** `?key=…` is what most examples use, and it
 *      puts a secret into every proxy log, browser history and error report on the way. `x-goog-api-key`
 *      is supported by the same endpoint and cannot end up in a URL.
 *   2. **JSON mode is requested, and the answer is still parsed defensively.** `responseMimeType:
 *      'application/json'` removes most of the preamble, and `parseGeminiAnswer` still strips a code
 *      fence and fails with a named error rather than letting `JSON.parse` throw into a route handler.
 *   3. **Every failure is one error type.** A timeout, a 4xx and an unparseable body are all
 *      `ExtractionFailedError`, so the route has one branch to write and the operator gets one message.
 */

import { sq } from '@/lib/copy/sq';

import { EXTRACTION_PROMPT } from './prompt';
import {
  ExtractionFailedError,
  type ExtractionProvider,
  type ExtractionRequest,
  type ExtractionResult,
} from './types';

const API_ORIGIN = 'https://generativelanguage.googleapis.com/v1beta/models';

/** A phone photo of a receipt takes a few seconds; 45 s allows for a slow network without hanging. */
const DEFAULT_TIMEOUT_MS = 45_000;

type Fetcher = typeof fetch;

export function geminiEndpoint(model: string): string {
  return `${API_ORIGIN}/${encodeURIComponent(model)}:generateContent`;
}

/** The request body: the document inline, then the instruction. */
export function buildGeminiBody(request: ExtractionRequest): {
  readonly contents: readonly { readonly parts: readonly unknown[] }[];
  readonly generationConfig: {
    readonly responseMimeType: string;
    readonly temperature: number;
    readonly maxOutputTokens: number;
  };
} {
  return {
    contents: [
      {
        parts: [
          // snake_case is what the v1beta REST endpoint documents. `inline_data` carries a photo and a
          // PDF alike: the endpoint accepts `application/pdf` there and reads the pages itself, so a
          // captured PDF is never rasterised on this side.
          {
            inline_data: {
              mime_type: request.mimeType,
              data: Buffer.from(request.bytes).toString('base64'),
            },
          },
          { text: EXTRACTION_PROMPT },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0,
      maxOutputTokens: 4096,
    },
  };
}

/** Removes a ```json fence, which models add even in JSON mode often enough to be worth handling. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/.exec(trimmed);

  return fenced === null ? trimmed : (fenced[1] ?? '').trim();
}

function firstTextPart(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const candidates = (payload as Readonly<Record<string, unknown>>)['candidates'];
  if (!Array.isArray(candidates)) {
    return null;
  }

  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) {
      continue;
    }

    const content = (candidate as Readonly<Record<string, unknown>>)['content'];
    if (typeof content !== 'object' || content === null) {
      continue;
    }

    const parts = (content as Readonly<Record<string, unknown>>)['parts'];
    if (!Array.isArray(parts)) {
      continue;
    }

    const text = parts
      .map((part) =>
        typeof part === 'object' && part !== null
          ? (part as Readonly<Record<string, unknown>>)['text']
          : undefined,
      )
      .filter((value): value is string => typeof value === 'string')
      .join('');

    if (text.trim() !== '') {
      return text;
    }
  }

  return null;
}

/** The model's JSON, or a named failure. Exported because this is the part worth unit testing. */
export function parseGeminiAnswer(payload: unknown): unknown {
  const text = firstTextPart(payload);

  if (text === null) {
    throw new ExtractionFailedError(sq.api.modelNoContent);
  }

  try {
    return JSON.parse(stripCodeFence(text));
  } catch {
    throw new ExtractionFailedError(sq.api.modelNotJson(stripCodeFence(text).slice(0, 200)));
  }
}

export type GeminiOptions = {
  readonly apiKey: string;
  readonly model: string;
  /** Injected in tests; defaults to the platform `fetch`. */
  readonly fetchImpl?: Fetcher | undefined;
  readonly timeoutMs?: number | undefined;
};

export async function extractWithGemini(
  request: ExtractionRequest,
  options: GeminiOptions,
): Promise<ExtractionResult> {
  const startedAt = Date.now();
  const fetcher = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let response: Response;
  try {
    response = await fetcher(geminiEndpoint(options.model), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': options.apiKey,
      },
      body: JSON.stringify(buildGeminiBody(request)),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    const message = timedOut
      ? sq.api.requestTimedOut(options.model, timeoutMs)
      : sq.api.requestFailed(options.model, timeoutMs);

    throw new ExtractionFailedError(message, { cause: error });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');

    throw new ExtractionFailedError(sq.api.providerAnswered(response.status, body.slice(0, 200)));
  }

  const payload: unknown = await response.json().catch(() => null);
  const raw = parseGeminiAnswer(payload);

  return {
    raw,
    provider: 'gemini',
    model: options.model,
    durationMs: Date.now() - startedAt,
  };
}

export function createGeminiProvider(options: GeminiOptions): ExtractionProvider {
  return {
    name: 'gemini',
    model: options.model,
    extract: (request: ExtractionRequest) => extractWithGemini(request, options),
  };
}
