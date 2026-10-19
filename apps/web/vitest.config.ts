import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Route handlers, server actions and lib code are plain functions, so they are tested by calling
    // them directly — no HTTP server, no Next runtime. Component tests get their own jsdom project
    // when the UI work starts in phase 3.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Only server-side logic carries a gate: UI code is covered by the E2E journeys instead
      // (a line-coverage number on JSX rewards shallow rendering tests, not correctness).
      include: ['src/lib/**/*.ts', 'src/server/**/*.ts', 'src/app/api/**/*.ts'],
      // `src/lib/copy/**` is pure data: a typed string table with nothing to execute, so counting it
      // would only dilute the gate that exists for logic.
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/lib/copy/**'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 75,
      },
    },
  },
});
