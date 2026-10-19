import { APP_NAME, APP_VERSION } from '@/lib/app-meta';

/**
 * Liveness probe.
 *
 * Answers one question only: "is this process running and able to serve a request?" It therefore
 * touches no dependency — not the database, not the environment schema, not the filesystem. A liveness
 * probe that fails because a downstream service is unhappy causes orchestrators to restart a perfectly
 * healthy container, and if the restart also deletes the container's only copy of the logs, the outage
 * is *caused* by the probe. Deep checks belong in `/api/ready`.
 *
 * Returns a plain Web `Response` rather than `NextResponse`: nothing here needs Next-specific helpers,
 * which keeps the handler trivially testable by calling it directly.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return Response.json(
    {
      status: 'ok',
      service: APP_NAME,
      version: APP_VERSION,
      environment: process.env.NODE_ENV ?? 'unknown',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
