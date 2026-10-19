/**
 * The extraction contract (D6: provider-agnostic, Gemini as the default implementation).
 *
 * One interface, two implementations, and the interface is deliberately tiny: bytes and a MIME type go
 * in, `unknown` comes out. `unknown` — not a typed invoice — because trusting a model's JSON is exactly
 * the mistake `@einv/shared`'s normaliser exists to catch, and a typed boundary here would only move
 * the cast one layer up.
 *
 * `extract` never throws for "the model answered badly": a bad answer is data, and the normaliser turns
 * it into problems a human reviews. It throws only when the extraction could not run at all (no key,
 * network failure, a non-2xx response), which the route reports as a failure rather than as an invoice.
 */

/** The provider-facing description of one image, so a failure can name what it was looking at. */
export type ExtractionRequest = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  /** Presentation only, echoed into logs; never part of a storage key. */
  readonly filename?: string | null;
};

export type ExtractionResult = {
  readonly raw: unknown;
  /** `gemini` | `stub` — recorded on the `extractions` row. */
  readonly provider: string;
  /** The exact model id, so a regression can be tied to a model change. */
  readonly model: string | null;
  readonly durationMs: number;
};

export type ExtractionProvider = {
  readonly name: string;
  readonly model: string | null;
  readonly extract: (request: ExtractionRequest) => Promise<ExtractionResult>;
};

/** Thrown when extraction could not run: a missing key, a timeout, or a non-2xx response. */
export class ExtractionFailedError extends Error {
  readonly code = 'EXTRACTION_FAILED';

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'ExtractionFailedError';
  }
}

/** Wraps any provider call in the timing and the shape the rest of the system expects. */
export async function runProvider(
  provider: ExtractionProvider,
  request: ExtractionRequest,
): Promise<ExtractionResult> {
  const startedAt = Date.now();
  const raw = await provider.extract(request);

  return {
    raw: raw.raw,
    provider: provider.name,
    model: provider.model,
    durationMs: raw.durationMs ?? Date.now() - startedAt,
  };
}
