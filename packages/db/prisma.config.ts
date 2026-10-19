import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 configuration.
 *
 * Two things moved out of `schema.prisma` that used to live there:
 *   * the connection string (`datasource.url` is deprecated) — it is read here instead, so the
 *     committed schema never contains a credential;
 *   * the seed script (previously `package.json#prisma.seed`), which is now `migrations.seed`.
 *
 * `prisma generate` and `prisma validate` must work on a machine with no database at all (CI lint
 * jobs, a fresh clone), so a missing DATABASE_URL is not an error here: it simply means no
 * datasource is configured and any command that needs a connection (`migrate`, `db seed`, `studio`)
 * fails with Prisma's own message.
 */
loadEnv({
  // The CLI always runs from this package (`pnpm --filter @einv/db …`), so the repository-root .env
  // is two directories up. A package-local .env, if present, is loaded second and therefore wins.
  path: [
    fileURLToPath(new URL('../../.env', import.meta.url)),
    fileURLToPath(new URL('.env', import.meta.url)),
  ],
  quiet: true,
});

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  ...(databaseUrl === undefined ? {} : { datasource: { url: databaseUrl } }),
});
