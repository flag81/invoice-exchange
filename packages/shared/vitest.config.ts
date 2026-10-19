import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      // `src/testing/**` holds the helpers that only make failures readable, and `index.ts` is a barrel
      // with nothing to execute; neither is domain logic, so neither belongs in the denominator.
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/**/*.types.ts', 'src/testing/**'],
      // The domain core is where correctness is cheapest to prove, so it carries the strictest gate.
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 95,
        branches: 90,
      },
    },
  },
});
