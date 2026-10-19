/**
 * The Prisma client — constructed once, here, and nowhere else.
 *
 * Two things this module owns that the repositories must not re-decide:
 *
 *   1. **Configuration.** `DATABASE_URL` is read in exactly one place, and a missing value is a
 *      named failure (`DatabaseUnavailableError`) rather than a stack trace from inside the driver.
 *      The MVP runs without a database for the capture path, so "no database" has to be a state the
 *      app can describe — the ready probe and the save endpoint both say what is missing.
 *   2. **The adapter.** Prisma 7's client talks to PostgreSQL through a driver adapter
 *      (`@prisma/adapter-pg`), which is also what keeps the connection pool in this process rather
 *      than inside a Rust engine binary.
 *
 * Prisma's connection errors (`P1001` "cannot reach the database server", `P1017` "server has
 * closed the connection") are translated into the same named failure, because from the caller's
 * point of view "no database configured" and "database not reachable" need the same answer: a 503
 * with a message an operator can act on.
 */

import { PrismaClient } from './generated/prisma/client';

/** Thrown when the database cannot be used at all: not configured, or not reachable. */
export class DatabaseUnavailableError extends Error {
  readonly code = 'DATABASE_UNAVAILABLE';

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'DatabaseUnavailableError';
  }
}

/** Prisma error codes that mean "the database is not there / not usable right now". */
const CONNECTION_FAILURE_CODES: readonly string[] = [
  'P1000', // authentication failed
  'P1001', // cannot reach the database server
  'P1002', // the database server timed out
  'P1003', // the database does not exist
  'P1009', // the database already exists (schema drift, worth failing loudly)
  'P1010', // user was denied access
  'P1011', // error opening a TLS connection
  'P1017', // the server has closed the connection
];

export function isConnectionFailure(error: unknown): boolean {
  const code = (error as { readonly code?: unknown } | null)?.code;

  return typeof code === 'string' && CONNECTION_FAILURE_CODES.includes(code);
}

/** The trimmed `DATABASE_URL`, or `undefined` when it is absent or blank. */
export function databaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL?.trim();

  return url === undefined || url === '' ? undefined : url;
}

export function isDatabaseConfigured(): boolean {
  return databaseUrl() !== undefined;
}

let cachedClient: PrismaClient | undefined;

/**
 * The memoised client. Created lazily so that importing this module (which `apps/web` does on every
 * request, including the ones that touch no database) cannot fail on a machine without a database.
 */
export async function getPrismaClient(): Promise<PrismaClient> {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const url = databaseUrl();
  if (url === undefined) {
    throw new DatabaseUnavailableError(
      'DATABASE_URL nuk është vendosur. Nis bazën e zhvillimit (pnpm db:dev), drejto DATABASE_URL në një server PostgreSQL dhe pastaj ekzekuto pnpm db:migrate.',
    );
  }

  const { PrismaPg } = await import('@prisma/adapter-pg');

  cachedClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  return cachedClient;
}

/** Runs a query through the client, translating "no database" into one named error. */
export async function withDatabase<T>(run: (client: PrismaClient) => Promise<T>): Promise<T> {
  const client = await getPrismaClient();

  try {
    return await run(client);
  } catch (error) {
    if (isConnectionFailure(error)) {
      throw new DatabaseUnavailableError(
        `baza e të dhënave në ${describeTarget()} nuk u përgjigj; kontrollo që PostgreSQL punon dhe DATABASE_URL është i saktë`,
        { cause: error },
      );
    }

    throw error;
  }
}

/** Host and database only — never the credentials (see `dsn.ts` for the same rule elsewhere). */
function describeTarget(): string {
  const url = databaseUrl();
  if (url === undefined) {
    return '<not configured>';
  }

  try {
    const parsed = new URL(url);

    return `${parsed.hostname}${parsed.port === '' ? '' : `:${parsed.port}`}${parsed.pathname}`;
  } catch {
    return '<unparseable DATABASE_URL>';
  }
}

/** Closes the pool. Used by tests and by a graceful shutdown hook; safe to call when unused. */
export async function disconnectDatabase(): Promise<void> {
  const client = cachedClient;
  cachedClient = undefined;

  if (client !== undefined) {
    await client.$disconnect();
  }
}
