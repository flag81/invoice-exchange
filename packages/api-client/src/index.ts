/**
 * `@einv/api-client` — the HTTP surface of the exchange, described once.
 *
 * Phase 3 adds the request layer on top of this: the error envelope (`ApiError`), a `createClient`
 * that carries the session cookie or bearer token, and the typed endpoint functions that web, worker
 * and mobile all call. Everything it needs beyond `fetch` comes from `@einv/shared`, so the client
 * behaves identically in a browser, in a server component and in React Native.
 */
export { API_BASE_PATH, encodePathSegment, joinUrl } from './url';
