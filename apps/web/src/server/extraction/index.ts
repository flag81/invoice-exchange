/**
 * Choosing an extraction provider, once, from configuration.
 *
 * The rule is the one an operator can predict: an explicit `AI_PROVIDER` is obeyed (and if it names
 * `gemini` without a key, that is an error, not a silent fall-back to the stub — a deployment that
 * quietly stopped reading invoices would be worse than one that refuses to start). With no
 * `AI_PROVIDER`, a present `GEMINI_API_KEY` means Gemini and its absence means the stub, so a fresh
 * clone runs the whole pipeline without a key.
 */

import { sq } from '@/lib/copy/sq';
import { type ServerEnv } from '@/lib/env';

import { createGeminiProvider, type GeminiOptions } from './gemini';
import { createStubProvider } from './stub';
import { ExtractionFailedError, type ExtractionProvider } from './types';

export type ProviderDependencies = {
  /** Injected in tests so no network call is ever made. */
  readonly fetchImpl?: GeminiOptions['fetchImpl'];
};

export function selectExtractionProvider(
  env: ServerEnv,
  dependencies: ProviderDependencies = {},
): ExtractionProvider {
  const apiKey = env.GEMINI_API_KEY;

  if (env.AI_PROVIDER === 'stub') {
    return createStubProvider();
  }

  if (env.AI_PROVIDER === 'gemini' && apiKey === undefined) {
    throw new ExtractionFailedError(sq.api.missingKey);
  }

  if (apiKey === undefined) {
    return createStubProvider();
  }

  return createGeminiProvider({
    apiKey,
    model: env.GEMINI_MODEL,
    ...(dependencies.fetchImpl === undefined ? {} : { fetchImpl: dependencies.fetchImpl }),
  });
}

/** Said out loud in logs and on the review screen: which reader produced these numbers. */
export function describeProvider(provider: ExtractionProvider): string {
  return provider.model === null ? provider.name : `${provider.name} (${provider.model})`;
}
