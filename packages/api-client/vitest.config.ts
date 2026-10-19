import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The client is environment-agnostic; tests run in Node and assert on request shapes, not on
    // browser APIs. Mobile and browser behaviour is covered by the E2E suites in phase 3+.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 75,
      },
    },
  },
});
