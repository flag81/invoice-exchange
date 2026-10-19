/**
 * The `local` storage driver — where a photographed invoice is put in development, in CI and in tests.
 *
 * ADR 0004 gives the driver four operations (`put`, `get`, `delete`, `presign`) behind one interface so
 * that tests never need a bucket. The capture slice needs two of them; `put` and `get` are implemented
 * and the other two are deliberately absent, because an unused `presign` that always throws is a
 * promise the code cannot keep — phase 4 adds them with the download flow that needs them.
 *
 * Two security properties are enforced here rather than at the call site, because a storage path is
 * one of the few places where a bug is a filesystem escape:
 *
 *   1. **Keys are server-generated.** `buildStorageKey` composes them from the company id, the year, the
 *      month and a UUID; the uploaded filename is never part of a path.
 *   2. **A key is validated before it becomes a path.** `resolveObjectPath` refuses `..`, absolute
 *      paths and anything that resolves outside the configured root, so even a key that reached this
 *      function from somewhere unexpected cannot write where it should not.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

/** Thrown when a key is not a key this driver would have generated. */
export class UnsafeStorageKeyError extends Error {
  readonly code = 'UNSAFE_STORAGE_KEY';

  constructor(key: string) {
    super(`"${key}" nuk është një çelës ruajtjeje i sigurt`);
    this.name = 'UnsafeStorageKeyError';
  }
}

export type StorageKeyParts = {
  readonly companyId: string;
  /** `2026`. */
  readonly year: string;
  /** `03`, one-based, zero-padded. */
  readonly month: string;
  /** The file's name without a directory: a UUID plus the extension the sniffer chose. */
  readonly id: string;
  /** `jpg`, `png`, `heic`, `pdf`, … — from `extensionForDocumentMime`, never from the upload. */
  readonly extension: string;
};

/**
 * `companyId/yyyy/mm/uuid.ext` (ADR 0004, decision 4): tenant-namespaced, unguessable, and meaningless
 * without the `document_blobs` row that points at it.
 */
export function buildStorageKey(parts: StorageKeyParts): string {
  return `${parts.companyId}/${parts.year}/${parts.month}/${parts.id}.${parts.extension}`;
}

/** A fresh opaque id for one upload. Separate from `buildStorageKey` so tests can pass a fixed one. */
export function newStorageId(): string {
  return randomUUID();
}

/** `2026-03-14T09:00:00Z` → `{ year: '2026', month: '03' }`, always UTC. */
export function storagePeriod(date: Date): { readonly year: string; readonly month: string } {
  return {
    year: date.getUTCFullYear().toString().padStart(4, '0'),
    month: (date.getUTCMonth() + 1).toString().padStart(2, '0'),
  };
}

const KEY_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/** True when the key is the shape this driver generates: relative segments, no traversal, no root. */
export function isSafeStorageKey(key: string): boolean {
  if (key === '' || key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
    return false;
  }

  if (key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return false;
  }

  return KEY_PATTERN.test(key);
}

/** The filesystem path for a key, or a thrown `UnsafeStorageKeyError` — never a silent fallback. */
export function resolveObjectPath(root: string, key: string): string {
  if (!isSafeStorageKey(key)) {
    throw new UnsafeStorageKeyError(key);
  }

  const absoluteRoot = resolve(root);
  const path = resolve(absoluteRoot, key);

  if (!path.startsWith(`${absoluteRoot}${sep}`)) {
    throw new UnsafeStorageKeyError(key);
  }

  return path;
}

/** The SHA-256 recorded in `document_blobs`: the bytes' fingerprint, hex-encoded. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Writes the bytes, creating the tenant/period directories on first use. */
export async function putObject(root: string, key: string, bytes: Uint8Array): Promise<void> {
  const path = resolveObjectPath(root, key);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

/**
 * Reads the bytes back. A missing file is `null` rather than a thrown `ENOENT`: the caller's job is to
 * report "this upload is gone", which is an incident with a different HTTP answer than "you sent
 * nonsense".
 */
export async function getObject(root: string, key: string): Promise<Uint8Array | null> {
  const path = resolveObjectPath(root, key);

  try {
    return await readFile(path);
  } catch {
    return null;
  }
}
