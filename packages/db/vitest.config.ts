import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      // The generated client, the barrel and the test factories are not logic. The repositories are
      // excluded for the same reason `apps/web` excludes UI code: they are Prisma calls whose only
      // meaningful test is against a real PostgreSQL (the integration suite in the phase-2 exit gate),
      // and a line-coverage number earned by mocking the client would prove nothing about them. The
      // mapping they depend on — where the arithmetic actually is — is fully covered here.
      exclude: [
        'src/**/*.test.ts',
        'src/**/index.ts',
        'src/**/testing/**',
        'src/generated/**',
        'src/client.ts',
        'src/documents.ts',
        'src/extractions.ts',
        'src/tenancy.ts',
        'src/invoices/repository.ts',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 75,
      },
    },
  },
});
