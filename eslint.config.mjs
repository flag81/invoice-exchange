// Root flat ESLint config (ESLint 10, typescript-eslint 8).
//
// Two jobs:
//   1. Baseline correctness/style for every workspace package.
//   2. Enforce the architecture boundaries from docs/architecture.md with
//      `no-restricted-imports`. These rules are the executable version of the
//      layering rules — if a boundary is only documented it will eventually be
//      broken, so it is a lint error instead.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.devdata/**',
      '**/next-env.d.ts',
      '**/prisma/migrations/**',
      '**/generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Prefer `as const` objects + union types over enums (see docs/architecture.md).',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },

  // ---- Boundary: packages/shared is the pure domain core --------------------
  // No framework, no Node built-ins, no database. Money, totals, tax, status
  // machines, permissions, schemas and formatters only. This is what makes the
  // domain testable in milliseconds and reusable by the future mobile app.
  {
    files: ['packages/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'next',
                'next/*',
                'react',
                'react-dom',
                'react/*',
                '@prisma/client',
                '@prisma/*',
                '@einv/db',
                '@einv/web',
                '@einv/api-client',
                'node:*',
                'fs',
                'path',
                'crypto',
                'os',
                'child_process',
                'zod',
              ],
              message:
                'packages/shared must stay framework-, runtime- and dependency-free. Put I/O in apps/web and DB code in packages/db.',
            },
          ],
        },
      ],
    },
  },

  // ---- Boundary: packages/api-client runs in browsers AND React Native ------
  {
    files: ['packages/api-client/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'next',
                'next/*',
                'react-dom',
                '@prisma/client',
                '@prisma/*',
                '@einv/db',
                'node:*',
                'fs',
                'path',
                'crypto',
                'server-only',
              ],
              message:
                'packages/api-client must run unchanged in the browser and in React Native. Use global `fetch` only.',
            },
          ],
        },
      ],
    },
  },

  // ---- Boundary: packages/db is the only place that talks to Prisma --------
  {
    files: ['packages/db/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'next',
                'next/*',
                'react',
                'react-dom',
                'server-only',
                '@einv/web',
                '@einv/api-client',
              ],
              message: 'packages/db must not depend on the web app or HTTP layer.',
            },
          ],
        },
      ],
    },
  },

  // ---- Boundary: client components are server-blind -------------------------
  // Client components must never reach the database, the mailer or a secret.
  //
  // Scoped to `src/components/**` rather than to every `.tsx` in the app directory: a Next
  // `page.tsx`/`layout.tsx` is a *server* component, and the capture pages legitimately read the
  // database and the readiness probe before rendering. The convention that makes the boundary
  // enforceable is that anything interactive lives under `src/components` (and starts with
  // `'use client'`) instead of next to its route — which is where every component in this app lives.
  {
    files: ['apps/web/src/components/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@einv/db', '@/server/*', 'server-only', 'fs', 'path', 'crypto', 'node:*'],
              message:
                'Client components must not import server-only modules. Move the logic into a server action or route handler.',
            },
          ],
        },
      ],
    },
  },

  // ---- Test + script ergonomics -------------------------------------------
  {
    files: [
      '**/*.{test,spec}.{ts,tsx}',
      '**/scripts/**/*.{ts,mjs,js}',
      '**/*.config.{ts,mjs,js}',
      '**/prisma/seed.ts',
    ],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
