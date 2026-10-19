/**
 * Connection-string helpers.
 *
 * A raw `DATABASE_URL` contains the database password, so it must never reach a log line, an error
 * message, a health-check response or a Sentry breadcrumb. Everything that wants to *report* which
 * database we are talking to uses `redactDatabaseUrl` instead of the raw value.
 */

const REDACTED = '***';

/**
 * Returns a copy of a database URL that is safe to log: credentials are masked, query parameters
 * other than `schema` (which may hold `password=…` for some providers) are dropped.
 *
 * `postgresql://alice:s3cret@db.internal:5432/invoices?schema=public&password=oops`
 *   -> `postgresql://alice:***@db.internal:5432/invoices?schema=public`
 *
 * Unparseable input yields `'<invalid-database-url>'` rather than throwing: this function is used on
 * error paths where throwing would hide the original failure.
 */
export function redactDatabaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return '<invalid-database-url>';
  }

  const protocol = parsed.protocol || 'postgresql:';
  const username = parsed.username ? decodeURIComponent(parsed.username) : '';
  const auth = username ? `${username}:${REDACTED}@` : '';
  const host = parsed.hostname ? parsed.host : '<no-host>';
  const database = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
  const schema = parsed.searchParams.get('schema');
  const query = schema ? `?schema=${schema}` : '';

  return `${protocol}//${auth}${host}${database}${query}`;
}

/**
 * Describes the target database without exposing it: used by `/api/ready` and by start-up logs.
 * Returns a structurally identical shape for every driver so callers never branch on the URL format.
 */
export type DatabaseTarget = {
  readonly protocol: string;
  readonly host: string;
  readonly port: string | null;
  readonly database: string | null;
  readonly schema: string | null;
  readonly user: string | null;
};

export function describeDatabaseUrl(raw: string): DatabaseTarget {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      protocol: 'unknown',
      host: '<invalid>',
      port: null,
      database: null,
      schema: null,
      user: null,
    };
  }

  return {
    protocol: parsed.protocol.replace(/:$/, ''),
    host: parsed.hostname,
    port: parsed.port === '' ? null : parsed.port,
    database: parsed.pathname.replace(/^\//, '') || null,
    schema: parsed.searchParams.get('schema'),
    user: parsed.username === '' ? null : decodeURIComponent(parsed.username),
  };
}
