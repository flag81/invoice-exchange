/**
 * Version markers for the domain core.
 *
 * `DOMAIN_API_VERSION` is bumped whenever a *stored* representation changes in a way older readers
 * cannot interpret — invoice version snapshots, audit payloads, outbox event bodies. The value is
 * written into those records, which is what makes it possible to keep reading a 2026 invoice in 2036
 * without guessing which shape it had.
 */
export const DOMAIN_API_VERSION = 1 as const;

/** Canonical package name, used in logs and error reports instead of a hard-coded string. */
export const DOMAIN_PACKAGE_NAME = '@einv/shared' as const;
