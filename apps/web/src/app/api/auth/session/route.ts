import { listMembershipsForUser } from '@einv/db';

import { jsonResponse, toErrorResponse } from '@/server/http';
import { requireActor } from '@/server/auth/session';

/**
 * `GET /api/auth/session` — "who am I, and which company am I acting for?"
 *
 * The mobile client's first call after sign-in, and the server's own answer to the same question the pages
 * ask through `currentActor`. It is a `401` rather than `{ session: null }` when there is no session:
 * every other route in this API answers `UNAUTHENTICATED` in that situation, and one endpoint with a
 * different convention is how clients grow two code paths for the same fact.
 *
 * `memberships` is returned in full even though the MVP has one company per person: switching company is
 * a settings screen away, and the list costs one indexed query.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireActor(request);
    const memberships = await listMembershipsForUser(actor.userId);

    return jsonResponse({
      user: {
        id: actor.userId,
        email: actor.email,
        name: actor.name,
        imageUrl: actor.imageUrl,
      },
      company: {
        id: actor.tenant.companyId,
        name: actor.tenant.companyName,
        role: actor.role,
      },
      memberships,
      expiresAt: actor.expiresAt.toISOString(),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
