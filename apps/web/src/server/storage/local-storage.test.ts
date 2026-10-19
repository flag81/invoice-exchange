import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  UnsafeStorageKeyError,
  buildStorageKey,
  getObject,
  isSafeStorageKey,
  newStorageId,
  putObject,
  resolveObjectPath,
  sha256Hex,
  storagePeriod,
} from './local-storage';

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'einv-storage-'));
  roots.push(root);

  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe('buildStorageKey', () => {
  it('namespaces by company and period, and never by the uploaded filename', () => {
    const key = buildStorageKey({
      companyId: 'company-1',
      year: '2026',
      month: '03',
      id: 'abc-123',
      extension: 'jpg',
    });

    expect(key).toBe('company-1/2026/03/abc-123.jpg');
  });

  it('derives the period in UTC, so the folder does not shift with the clock', () => {
    expect(storagePeriod(new Date('2026-01-01T00:30:00.000Z'))).toEqual({
      year: '2026',
      month: '01',
    });
    expect(storagePeriod(new Date('2026-12-31T23:30:00.000Z'))).toEqual({
      year: '2026',
      month: '12',
    });
  });

  it('generates an opaque id per upload', () => {
    const first = newStorageId();
    const second = newStorageId();

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('isSafeStorageKey', () => {
  it('accepts the shape this driver generates', () => {
    expect(isSafeStorageKey('company/2026/03/id.jpg')).toBe(true);
    expect(isSafeStorageKey('company-1/2026/03/id.heic')).toBe(true);
  });

  it('refuses traversal, absolute paths and empty segments', () => {
    expect(isSafeStorageKey('')).toBe(false);
    expect(isSafeStorageKey('/etc/passwd')).toBe(false);
    expect(isSafeStorageKey('company/2026/../../etc/passwd')).toBe(false);
    expect(isSafeStorageKey('company//id.jpg')).toBe(false);
    expect(isSafeStorageKey('./id.jpg')).toBe(false);
    expect(isSafeStorageKey('company\\id.jpg')).toBe(false);
    expect(isSafeStorageKey('company/id.jpg\0')).toBe(false);
    expect(isSafeStorageKey('company/id with spaces.jpg')).toBe(false);
  });
});

describe('resolveObjectPath', () => {
  it('resolves inside the configured root', () => {
    expect(resolveObjectPath('/data/storage', 'company/2026/03/id.jpg')).toBe(
      resolve('/data/storage/company/2026/03/id.jpg'),
    );
  });

  it('throws rather than writing outside the root', () => {
    expect(() => resolveObjectPath('/data/storage', '../secrets.txt')).toThrowError(
      UnsafeStorageKeyError,
    );
    expect(() => resolveObjectPath('/data/storage', 'a/../../b.txt')).toThrowError(
      /nuk është një çelës ruajtjeje i sigurt/,
    );
  });
});

describe('sha256Hex', () => {
  it('matches the well-known digest of "abc"', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('putObject and getObject', () => {
  it('writes the bytes under the key and reads them back unchanged', async () => {
    const root = await temporaryRoot();
    const key = 'company-1/2026/03/id.jpg';
    const bytes = Uint8Array.of(0xff, 0xd8, 0xff, 0x01, 0x02);

    await putObject(root, key, bytes);

    await expect(readdir(join(root, 'company-1', '2026', '03'))).resolves.toEqual(['id.jpg']);
    const stored = await getObject(root, key);

    expect(stored).not.toBeNull();
    expect(Array.from(stored ?? [])).toEqual(Array.from(bytes));
  });

  it('reports a missing object as null instead of throwing a filesystem error', async () => {
    const root = await temporaryRoot();

    expect(await getObject(root, 'company-1/2026/03/missing.jpg')).toBeNull();
  });

  it('refuses an unsafe key on the way in as well as on the way out', async () => {
    const root = await temporaryRoot();

    await expect(putObject(root, '../escape.jpg', Uint8Array.of(1))).rejects.toThrowError(
      UnsafeStorageKeyError,
    );
    await expect(getObject(root, '../escape.jpg')).rejects.toThrowError(UnsafeStorageKeyError);
  });
});
