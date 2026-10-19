/**
 * The CSRF gate for cookie-authenticated requests (§5.3).
 *
 * A session cookie is sent by the browser on *any* request to this origin, including one a malicious
 * page caused. The defence that costs nothing is to refuse a state-changing request whose `Origin` says
 * it came from somewhere else. `SameSite=Lax` already blocks most of this; this check is the belt to that
 * brace, and it is what makes `POST /api/auth/logout` (a plain HTML form away) safe.
 *
 * The rules, in order:
 *
 *   1. `Origin` present → it must be this deployment's origin, exactly.
 *   2. No `Origin`, but `Sec-Fetch-Site` present → it must be `same-origin` or `none` (a typed URL).
 *   3. Neither header → allow. Browsers always send `Origin` on cross-origin writes, so this is a
 *      non-browser client (curl, the mobile app), which cannot be tricked into carrying somebody's cookie.
 *
 * `Referer` is not consulted: it is stripped by privacy settings often enough to produce false
 * refusals, and it would add nothing the two headers above do not already say.
 */

import { AuthError, AuthErrorCode } from './errors';

/** Methods that may change state. Everything else is a read. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase());
}

/** `https://host:port` of the configured deployment, or `null` when `APP_URL` is unparseable. */
export function configuredOrigin(appUrl: string): string | null {
  try {
    return new URL(appUrl).origin;
  } catch {
    return null;
  }
}

export type OriginVerdict = 'same-origin' | 'cross-origin' | 'not-a-browser';

/**
 * What the headers say about where this request came from.
 *
 * `not-a-browser` is not a claim of safety — it is the absence of a browser's automatic cookie
 * attachment, which is the thing CSRF needs.
 */
export function originVerdict(
  headers: { get(name: string): string | null },
  appUrl: string,
): OriginVerdict {
  const origin = headers.get('origin');

  if (origin !== null && origin !== '') {
    const expected = configuredOrigin(appUrl);

    return expected !== null && origin === expected ? 'same-origin' : 'cross-origin';
  }

  const fetchSite = headers.get('sec-fetch-site');

  if (fetchSite !== null && fetchSite !== '') {
    return fetchSite === 'same-origin' || fetchSite === 'none' ? 'same-origin' : 'cross-origin';
  }

  return 'not-a-browser';
}

/**
 * Throws unless a mutating request demonstrably came from this site.
 *
 * Calls with a safe method are always allowed, so this can be the first line of every authenticated
 * route without a per-method condition.
 */
export function assertSameOrigin(request: Request, appUrl: string): void {
  if (!isMutatingMethod(request.method)) {
    return;
  }

  if (originVerdict(request.headers, appUrl) === 'cross-origin') {
    throw new AuthError(
      AuthErrorCode.CROSS_ORIGIN,
      'kjo kërkesë nuk vjen nga kjo faqe; hape aplikacionin dhe provo përsëri',
    );
  }
}
