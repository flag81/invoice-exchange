/**
 * Test-only helpers, excluded from coverage and never imported by domain code (`vitest.config.ts`).
 *
 * They live in `src/testing/` rather than being repeated in every spec because a domain failure is not
 * interesting for *that* it threw — it is interesting for *which* `code` it threw, since that code is
 * what the caller, the audit trail and the HTTP layer branch on. `expectDomainError` asserts the code and
 * keeps the message and details in the failure output, so a broken rule is readable in CI.
 */

import { expect } from 'vitest';

import { isDomainError, type DomainError, type DomainErrorCode } from '../errors';

/** Runs `run` and returns the `DomainError` it threw. Re-throws (i.e. fails) anything else. */
export function captureDomainError(run: () => unknown): DomainError {
  try {
    run();
  } catch (error) {
    if (isDomainError(error)) {
      return error;
    }

    throw error;
  }

  throw new Error('expected the call to throw a DomainError, but it returned normally');
}

/** Asserts that `run` fails with exactly `code`, and that it says something to a human. */
export function expectDomainError(run: () => unknown, code: DomainErrorCode): DomainError {
  const error = captureDomainError(run);

  expect(error.code).toBe(code);
  expect(error.message.trim().length).toBeGreaterThan(0);

  return error;
}
