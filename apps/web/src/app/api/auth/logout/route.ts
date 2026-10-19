import { serverEnv } from '@/lib/env';

import { assertSameOrigin } from '@/server/auth/origin';
import { redirectResponse } from '@/server/auth/redirect';
import { endSession } from '@/server/auth/session';
import { toErrorResponse } from '@/server/http';

/**
 * `POST /api/auth/logout` — the header's "Dil" button, and the end of a session everywhere.
 *
 * `POST` because signing someone out is a mutation, and a `GET` would be triggered by a prefetcher or an
 * `<img>` tag on an unrelated page. The cookie is deleted server-side as well as client-side: a stolen
 * cookie stays worthless, because the row it pointed at is gone.
 *
 * The response is a `303` to `/signin` so the plain form works with JavaScript disabled. An API client
 * that would rather have JSON gets `toErrorResponse` on failure only — success is the redirect, which is
 * the same thing a browser does.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request, serverEnv().APP_URL);
    const cookie = await endSession(request);

    return redirectResponse('/signin', [cookie]);
  } catch (error) {
    return toErrorResponse(error);
  }
}
