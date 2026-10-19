import { describeDatabaseUrl } from '@einv/db';

import { parseServerEnv, type ServerEnv } from '@/lib/env';

/**
 * Readiness probe.
 *
 * Answers "may traffic be sent here yet?" — which is a different question from liveness, and the
 * difference matters: a container that is up but cannot reach its database must be pulled out of the
 * load balancer, not restarted.
 *
 * What is checked today (phase 0): the environment parses, and `DATABASE_URL` is present and
 * structurally a PostgreSQL URL. Note what is *not* claimed: the string is not yet dereferenced, so
 * the check is named after what it proves. Phase 2 replaces it with a real `SELECT 1` plus a migration
 * check and adds the queue and storage probes; the response shape stays the same, so the platform
 * config does not change.
 *
 * Failures return 503 with the same structured body, so an operator sees *which* dependency is down.
 * No credentials are ever echoed: database details come from `describeDatabaseUrl`, which strips them.
 *
 * **Deliberately unauthenticated.** The caller is a load balancer or container runtime, which cannot hold
 * a session cookie, and a probe behind `requireActor` would answer 401 to every platform check and take
 * the deployment out of rotation for the wrong reason. It is safe to leave open because it reads only
 * configuration: no tenant, no invoice, and no secret beyond the host and database name the platform
 * already knows. Everything that touches a company's data goes through `requireActor`.
 */
export const dynamic = 'force-dynamic';

type CheckStatus = 'pass' | 'warn' | 'fail';

type Check = {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
};

const POSTGRES_PROTOCOLS = ['postgresql', 'postgres'];

/**
 * Which reader the capture flow will use — and whether its numbers mean anything.
 *
 * This is a readiness question, not a curiosity: a deployment whose `GEMINI_API_KEY` was forgotten
 * does not fail, it *lies* — the stub returns a plausible fixture that a person can save. `warn`
 * exists for exactly that state: the service is up, the pipeline works, and every number it shows is
 * an example. `fail` is reserved for a configuration that cannot read at all (`AI_PROVIDER=gemini`
 * with no key), which `selectExtractionProvider` refuses at request time.
 */
function extractionCheck(env: ServerEnv): Check {
  if (env.AI_PROVIDER === 'stub') {
    return {
      name: 'extraction',
      status: 'warn',
      detail:
        'AI_PROVIDER=stub — the capture flow returns a demo fixture, not a reading of the document',
    };
  }

  if (env.AI_PROVIDER === 'gemini' && env.GEMINI_API_KEY === undefined) {
    return {
      name: 'extraction',
      status: 'fail',
      detail: 'AI_PROVIDER=gemini but GEMINI_API_KEY is not set',
    };
  }

  if (env.GEMINI_API_KEY === undefined) {
    return {
      name: 'extraction',
      status: 'warn',
      detail:
        'stub (no GEMINI_API_KEY) — the capture flow returns a demo fixture, not a reading of the document',
    };
  }

  return { name: 'extraction', status: 'pass', detail: `gemini (${env.GEMINI_MODEL})` };
}

export async function GET(): Promise<Response> {
  const checks: Check[] = [];
  let databaseUrl: string | undefined;
  let extraction: Check | null = null;

  try {
    const env = parseServerEnv(process.env);
    databaseUrl = env.DATABASE_URL;
    extraction = extractionCheck(env);
    checks.push({
      name: 'env',
      status: 'pass',
      detail: `node=${env.NODE_ENV}, logLevel=${env.LOG_LEVEL}, storage=${env.STORAGE_DRIVER}`,
    });
  } catch (error) {
    checks.push({
      name: 'env',
      status: 'fail',
      detail: error instanceof Error ? error.message : 'environment validation failed',
    });
  }

  if (databaseUrl === undefined) {
    checks.push({
      name: 'database',
      status: 'fail',
      detail:
        checks[0]?.status === 'pass'
          ? 'DATABASE_URL is not set'
          : 'skipped: the environment is invalid',
    });
  } else {
    const target = describeDatabaseUrl(databaseUrl);
    if (!POSTGRES_PROTOCOLS.includes(target.protocol)) {
      checks.push({
        name: 'database',
        status: 'fail',
        detail: `DATABASE_URL must be a postgresql:// URL, got ${
          target.protocol === 'unknown' ? 'an unparseable value' : `"${target.protocol}://"`
        }`,
      });
    } else {
      checks.push({
        name: 'database',
        status: 'pass',
        detail: `postgresql://${target.host}${target.port ? `:${target.port}` : ''}/${
          target.database ?? '?'
        } (configured; connectivity is probed from phase 2)`,
      });
    }
  }

  // The reader is reported after the database so the shape of the response stays stable for existing
  // callers; a `warn` here does not take the service out of rotation, it tells the operator that every
  // number the capture flow shows is a fixture.
  checks.push(
    extraction ?? {
      name: 'extraction',
      status: 'fail',
      detail: 'skipped: the environment is invalid',
    },
  );

  const ready = checks.every((check) => check.status !== 'fail');

  return Response.json(
    {
      status: ready ? 'ready' : 'degraded',
      checks,
    },
    {
      status: ready ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
