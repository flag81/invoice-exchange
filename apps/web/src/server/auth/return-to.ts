/**
 * Where to send a person after signing in.
 *
 * The value arrives in a query string (`?next=/invoices/123`), so it is user input on its way into a
 * `Location` header. Only a *path on this site* is allowed: a single leading `/`, no `//` (which browsers
 * read as a protocol-relative host), no backslashes (which some browsers normalise to `/`), no control
 * characters or whitespace, and nothing that tries to smuggle a scheme (`/https://evil` is a path, but
 * `/\\evil.com` is not going to be interpreted as one).
 *
 * Anything else becomes `/` — the home screen, which is always a safe place to land.
 */

/**
 * Whether a character makes the path unsafe: a control character (which a header cannot carry), a
 * backslash (which some browsers normalise to `/`, so `/\\evil.com` would become a host) or whitespace.
 *
 * Written as a predicate rather than a regular expression on purpose: a pattern containing literal
 * control characters is exactly the kind of line a reader cannot see, and `no-control-regex` refuses it.
 */
function isUnsafeCharacter(character: string): boolean {
  const code = character.charCodeAt(0);

  return code <= 0x1f || code === 0x7f || character === '\\' || /\s/.test(character);
}

export const DEFAULT_RETURN_TO = '/';

export function safeReturnTo(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return DEFAULT_RETURN_TO;
  }

  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    [...value].some((character) => isUnsafeCharacter(character))
  ) {
    return DEFAULT_RETURN_TO;
  }

  return value;
}

/** The sign-in URL for a path, with the path carried in `next`. */
export function signInPath(returnTo: string = DEFAULT_RETURN_TO): string {
  const safe = safeReturnTo(returnTo);

  return safe === DEFAULT_RETURN_TO ? '/signin' : `/signin?next=${encodeURIComponent(safe)}`;
}

/**
 * The sign-in URL that explains a failed attempt.
 *
 * The *code* travels, not a message: `/signin` turns it into Albanian through `authErrorLabel`, so a
 * provider's own prose — which can contain anything — never becomes a sentence on this site.
 */
export function signInErrorPath(code: string, returnTo: string = DEFAULT_RETURN_TO): string {
  const safe = safeReturnTo(returnTo);
  const params = new URLSearchParams({ error: code });

  if (safe !== DEFAULT_RETURN_TO) {
    params.set('next', safe);
  }

  return `/signin?${params.toString()}`;
}
