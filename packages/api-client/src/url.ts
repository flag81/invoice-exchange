/**
 * URL construction for the exchange HTTP API.
 *
 * Every endpoint the client calls is built with `joinUrl`, so there is exactly one place where
 * double slashes, missing slashes and lost query strings can be introduced — and one place with
 * tests. Resource ids go through `encodePathSegment`, because an id that contains `/` or a space
 * must never be able to change which endpoint is addressed.
 */

/** Base path of the versioned JSON API. The HTML app and the API share one deployment. */
export const API_BASE_PATH = '/api/v1';

/**
 * Joins a base URL with path segments, normalising slashes and keeping the query string from the
 * last segment that has one (so `joinUrl(base, 'invoices', '?status=draft')` behaves as expected).
 *
 * Empty segments are ignored, which makes optional path parts (`tenantSlug ?? ''`) safe to pass
 * inline. Absolute bases (`https://api.example.test`), root-relative bases (`/api/v1`) and plain
 * relative bases (`api/v1`) are all supported, so the same helper works for the web app, for
 * server-side fetches and for the React Native client.
 */
export function joinUrl(baseUrl: string, ...segments: readonly string[]): string {
  const base = splitQuery(baseUrl);
  const baseMatch = /^([a-z][a-z0-9+.-]*:)?(\/\/)?(\/?)(.*)$/i.exec(base.path);
  const scheme = baseMatch?.[1] ?? '';
  const authoritySlashes = baseMatch?.[2] ?? '';
  const rootRelative = scheme === '' && authoritySlashes === '' && base.path.startsWith('/');
  const basePath = baseMatch?.[4] ?? base.path;

  let query = base.query;
  const pathParts: string[] = [basePath];

  for (const segment of segments) {
    const split = splitQuery(segment);
    pathParts.push(split.path);
    if (split.query !== '') {
      query = split.query;
    }
  }

  const path = pathParts
    .map((part) => part.replace(/^\/+/, '').replace(/\/+$/, ''))
    .filter((part) => part !== '')
    .join('/');

  const prefix = `${scheme}${authoritySlashes}`;
  const separator = path === '' || prefix === '' || prefix.endsWith('/') ? '' : '/';
  const leadingSlash = path !== '' && prefix === '' && rootRelative ? '/' : '';
  const querySuffix = query === '' ? '' : `?${query}`;

  return `${prefix}${separator}${leadingSlash}${path}${querySuffix}`;
}

/**
 * Percent-encodes a value for use as a single path segment. Use it for every id that comes from
 * user input or from the API, so a value like `../../admin` cannot escape its segment.
 */
export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function splitQuery(value: string): { path: string; query: string } {
  const index = value.indexOf('?');
  if (index === -1) {
    return { path: value, query: '' };
  }

  return { path: value.slice(0, index), query: value.slice(index + 1) };
}
