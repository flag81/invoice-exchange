/**
 * PKCE (RFC 7636), method `S256`.
 *
 * The verifier never leaves the server: it goes into the `oauth_states` row (and an HttpOnly cookie so
 * the callback can prove the same browser started the attempt). Only its SHA-256 travels to Google, so
 * an authorization code intercepted on the way back — a shared redirect URI, a log, a proxy — is useless
 * without the verifier.
 *
 * `plain` is not implemented because it is not a choice worth offering: S256 costs one hash.
 */

import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes → 43 base64url characters, inside RFC 7636's 43..128 range. */
export function createCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** `BASE64URL(SHA256(verifier))`, the `code_challenge` Google receives. */
export function codeChallengeS256(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
}
