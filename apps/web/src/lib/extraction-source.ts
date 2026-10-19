/**
 * "Who read this document — and may its numbers be trusted?"
 *
 * The capture pipeline has two providers, and only one of them reads the file. `gemini` sends the
 * bytes to a vision model; `stub` deliberately reads nothing and returns a deterministic fixture, so
 * the whole flow can be exercised without a key. That difference is invisible in the draft itself —
 * a fixture is *plausible* — which is exactly why the review screen has to say who read what.
 *
 * These are the pure decisions behind that sentence, kept out of the component so they are testable
 * in the same Node project as the rest of `src/lib`.
 */

/** What the extraction endpoint reports about the reading that produced a draft. */
export type ExtractionSourceView = {
  readonly provider: string;
  readonly model: string | null;
  readonly durationMs: number | null;
};

/**
 * Reading `unknown` JSON without trusting it: the provider fields are decoration for a human, but a
 * malformed one must not throw inside the review screen. `null` means "the response did not say".
 */
export function toExtractionSource(value: unknown): ExtractionSourceView | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Readonly<Record<string, unknown>>;
  const provider = record['provider'];

  if (typeof provider !== 'string' || provider.trim() === '') {
    return null;
  }

  const model = record['model'];
  const duration = record['durationMs'];

  return {
    provider: provider.trim(),
    model: typeof model === 'string' && model.trim() !== '' ? model.trim() : null,
    durationMs:
      typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? duration : null,
  };
}

/**
 * Whether this draft came from the fixture rather than from the document. Case-insensitive and
 * whitespace-tolerant because the value crosses an HTTP boundary, and a demo must not become real
 * because somebody typed `Stub`.
 */
export function isDemoExtraction(provider: string | null | undefined): boolean {
  return (provider ?? '').trim().toLowerCase() === 'stub';
}

/** `gemini (gemini-2.5-flash)` — the provider, plus its model when it has one. */
export function extractionSourceLabel(provider: string, model: string | null): string {
  const name = provider.trim() === '' ? '?' : provider.trim();
  const id = model?.trim() ?? '';

  return id === '' ? name : `${name} (${id})`;
}

/**
 * How long the reading took, in the market's notation: `820 ms`, or `3,4 s` — a dot would read as a
 * thousands separator here (ADR 0007).
 */
export function formatExtractionDuration(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) {
    return null;
  }

  return durationMs < 1000
    ? `${Math.round(durationMs)} ms`
    : `${(durationMs / 1000).toFixed(1).replace('.', ',')} s`;
}
