/**
 * Seed — `pnpm db:seed` (Prisma no longer runs seeds implicitly on `migrate dev`/`reset`).
 *
 * It creates exactly what a fresh install needs:
 *
 *   * one company (the tenant) **with no members** — the first Google sign-in adopts it, which is how
 *     the invoices captured before sign-in existed stay reachable (ADR 0009);
 *   * the Kosovo VAT rates as *data* (§4.4 keeps rates as rows, so supporting another country is not a
 *     release), with 18 % marked default — the rate extraction falls back to when a printed percentage
 *     matches nothing. The table itself lives in `src/auth/provisioning.ts`, where sign-in uses it too;
 *   * the single `schema_health` row the readiness probe reads, so `/api/ready` proves the schema is
 *     actually there rather than merely connected.
 *
 * Idempotent on purpose: running it twice must not create a second tenant or duplicate rates. The
 * redacted target is printed so nobody has to guess which database is about to be written to.
 */

import { fileURLToPath } from 'node:url';

import { CurrencyCode } from '@einv/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnv } from 'dotenv';

import { KOSOVO_VAT_RATES } from '../src/auth/provisioning';
import { describeDatabaseUrl, redactDatabaseUrl } from '../src/dsn';
import { PrismaClient } from '../src/generated/prisma/client';

const DEMO_COMPANY = {
  name: 'Demo Market Sh.p.k',
  legalName: 'Demo Market Shoqëri me Përgjegjësi të Kufizuar',
  vatNumber: '810000000',
  countryCode: 'XK',
  currency: CurrencyCode.EUR,
} as const;

async function main(): Promise<void> {
  // Prisma loads `prisma.config.ts` in its own process; the seed runs as a child and inherits only
  // what the shell exported. Reading `.env` here is what makes `pnpm db:seed` work on a fresh clone.
  // Same precedence as `prisma.config.ts`: repository root first, a package-local `.env` wins.
  loadEnv({
    // `prisma/seed.ts` is one level below `prisma.config.ts`, hence the extra `..`.
    path: [
      fileURLToPath(new URL('../../../.env', import.meta.url)),
      fileURLToPath(new URL('../.env', import.meta.url)),
    ],
    quiet: true,
  });

  const url = process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env before seeding.');
  }

  const target = describeDatabaseUrl(url);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    await prisma.schemaHealth.upsert({
      where: { id: 1 },
      update: { revision: 1 },
      create: { id: 1, revision: 1 },
    });

    const existing = await prisma.company.findFirst({ where: { name: DEMO_COMPANY.name } });
    const company =
      existing ??
      (await prisma.company.create({
        data: {
          name: DEMO_COMPANY.name,
          legalName: DEMO_COMPANY.legalName,
          vatNumber: DEMO_COMPANY.vatNumber,
          countryCode: DEMO_COMPANY.countryCode,
          currency: DEMO_COMPANY.currency,
        },
      }));

    for (const rate of KOSOVO_VAT_RATES) {
      await prisma.taxRate.upsert({
        where: { companyId_code: { companyId: company.id, code: rate.code } },
        update: {
          name: rate.name,
          category: rate.category,
          ratePercent: rate.ratePercent,
          isDefault: rate.isDefault,
        },
        create: {
          companyId: company.id,
          code: rate.code,
          name: rate.name,
          category: rate.category,
          ratePercent: rate.ratePercent,
          countryCode: DEMO_COMPANY.countryCode,
          isDefault: rate.isDefault,
        },
      });
    }

    process.stdout.write(
      `seed: company "${company.name}" (${company.id}) with ${KOSOVO_VAT_RATES.length} VAT rates — ` +
        `target ${redactDatabaseUrl(url)} (host=${target.host}, database=${target.database ?? 'none'})\n` +
        'seed: the company has no members yet — the first Google sign-in adopts it (ADR 0009)\n',
    );
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
