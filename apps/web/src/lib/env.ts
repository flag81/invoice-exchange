import { z } from 'zod';

/**
 * Environment handling.
 *
 * Two rules, both learned the hard way in production systems:
 *
 *   1. The process environment is parsed **once**, into a typed value, and every other module reads
 *      that value. Scattered `process.env.X!` reads are how a service starts happily and then dies
 *      on the first payment attempt because `APP_URL` was misspelled.
 *   2. A missing value in development is a convenience; the same value missing in production is an
 *      outage. The defaults below are therefore *development* defaults, and `NODE_ENV` decides what
 *      is required — see the phase-3 note on required secrets.
 *
 * Empty strings are treated as "not set". A copied `.env.example` is full of `KEY=""` placeholders
 * (SMTP, OAuth, AI), and refusing to boot because of a placeholder is the kind of friction that
 * leads people to comment out the validation instead of filling in the file.
 */

const emptyStringToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(emptyStringToUndefined, z.string().min(1).optional());

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export const STORAGE_DRIVERS = ['local', 's3'] as const;

/**
 * Extraction back-ends. `stub` is not a mock of the model but a *provider* in its own right: it
 * produces a deterministic invoice derived from the image's bytes, so the whole capture pipeline —
 * upload, extract, review, save — can be exercised with no API key, in tests and on a train.
 */
export const AI_PROVIDERS = ['gemini', 'stub'] as const;

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Public base URL of this deployment: used for links in emails and for OAuth redirect URIs. */
  APP_URL: z.url().default('http://localhost:3001'),

  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

  /** Absent until phase 2; the database layer fails with its own, more specific error. */
  DATABASE_URL: optionalString,
  TEST_DATABASE_URL: optionalString,

  STORAGE_DRIVER: z.enum(STORAGE_DRIVERS).default('local'),
  STORAGE_LOCAL_ROOT: z.string().min(1).default('.devdata/storage'),
  /** Bytes accepted per upload; read with a digits-only grammar and a fail-closed default. */
  STORAGE_MAX_UPLOAD_BYTES: optionalString,

  /** Absent means "pick by key presence": Gemini when `GEMINI_API_KEY` is set, otherwise the stub. */
  AI_PROVIDER: z.preprocess(emptyStringToUndefined, z.enum(AI_PROVIDERS).optional()),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),

  /** Absent means "log the message instead of sending it" (development, tests). */
  SMTP_URL: optionalString,
  MAIL_FROM: z.string().min(1).default('invoices@example.test'),

  /**
   * Google sign-in (ADR 0009). All three are optional, and a missing client id turns the feature *off*
   * honestly: `/signin` explains what to set instead of offering a button that cannot work, and the
   * OAuth routes answer 503. `OAUTH_REDIRECT_BASE_URL` defaults to `APP_URL`; it exists so a deployment
   * behind a proxy can hand Google a different base than the one it serves.
   */
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  OAUTH_REDIRECT_BASE_URL: optionalString,
  /** The session cookie's name. Renaming it is a way to sign everyone out at deploy time. */
  AUTH_SESSION_COOKIE_NAME: optionalString,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Validates a source of environment variables and throws with **every** problem at once, naming the
 * offending keys. Failing once with "APP_URL: Invalid URL; LOG_LEVEL: Invalid option" is far more
 * useful than a stack trace from whichever line happened to read the variable first.
 */
export function parseServerEnv(source: Readonly<Record<string, string | undefined>>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${details}`);
  }

  return result.data;
}

let cachedServerEnv: ServerEnv | undefined;

/** Memoised view of `process.env`. Safe to call from any server code; never import in a client component. */
export function serverEnv(): ServerEnv {
  cachedServerEnv ??= parseServerEnv(process.env);
  return cachedServerEnv;
}

/**
 * Forgets the memoised environment. Used by tests that stub variables between cases (a memoised value
 * would silently answer with the previous test's configuration) and, in development, by a reload after
 * `.env` changes.
 */
export function resetServerEnv(): void {
  cachedServerEnv = undefined;
}

/**
 * The only values that may reach the browser. Listing them explicitly (rather than exporting
 * `process.env`) is what keeps a secret from being bundled into client JavaScript by accident.
 */
export const publicEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? '',
  nodeEnv: process.env.NODE_ENV ?? 'development',
} as const;
