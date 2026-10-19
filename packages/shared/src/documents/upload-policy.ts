/**
 * What may be uploaded — decided from the bytes, never from the client's word.
 *
 * The capture screen runs in a phone browser, so the file that arrives is whatever the camera app
 * produced: usually JPEG, sometimes PNG (a screenshot), WebP (Android), or HEIC/HEIF (iPhone). Many
 * suppliers send the invoice as a PDF instead — a single file exported by an accounting program or
 * emailed by the supplier — so a PDF is a first-class capture input too, not a conversion target: it
 * is stored as uploaded and read by the extraction provider in place.
 *
 * The declared `Content-Type` is attacker-controlled, and it is wrong in the innocent direction too —
 * iOS Safari sends `image/jpeg` for a HEIC file — so the only type this system trusts is the one it
 * detected itself, from the magic bytes of the stored file (docs/adr/0004, decision 6).
 *
 * This is the pure half of the upload path: no file system, no HTTP, no `crypto`. Bytes in, decision
 * out — which is why it can live in the domain core and be tested in microseconds.
 */

export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  /** iPhone default camera format (`ftyp` brand family). */
  'image/heic',
  'image/heif',
] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

/** A PDF is not an image and is never decoded as one; it is the second kind of capture input. */
export const PDF_MIME_TYPE = 'application/pdf';

export type DocumentMimeType = ImageMimeType | typeof PDF_MIME_TYPE;

/** Everything the capture endpoint accepts, images first because that is the common case. */
export const DOCUMENT_MIME_TYPES = [...IMAGE_MIME_TYPES, PDF_MIME_TYPE] as const;

/**
 * 8 MiB. A 12 MP iPhone photo is 2–5 MiB after the camera's own compression; an 8 MiB ceiling accepts
 * every real invoice photo while keeping one request from filling the server's disk or memory. A
 * scanned PDF is usually smaller than the photo it was scanned from, and an emailed invoice PDF is
 * tens of kilobytes, so the same ceiling serves both kinds of input.
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const MIME_EXTENSIONS: Readonly<Record<DocumentMimeType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
};

/** ISO base media brands that mean "HEIF container with a HEVC still image" (the iPhone default). */
const HEIC_BRANDS: readonly string[] = [
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
];

/** The same container with an HEIF or AVIF payload — different subtypes, same family. */
const HEIF_BRANDS: readonly string[] = ['mif1', 'msf1', 'avif'];

function hasBytesAt(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (bytes.length < offset + expected.length) {
    return false;
  }

  return expected.every((byte, index) => bytes[offset + index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) {
    return '';
  }

  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(bytes[offset + index] ?? 0);
  }

  return text;
}

/** `%PDF-`: every PDF starts with it, whatever produced the file (`%PDF-1.7`). */
const PDF_SIGNATURE: readonly number[] = [0x25, 0x50, 0x44, 0x46, 0x2d];

/**
 * Sniffs the container from its first bytes. Returns `null` for anything that is not one of the five
 * accepted image types — including a text file with an image extension, which is exactly the case a
 * declared MIME type would have waved through.
 */
export function detectImageMime(bytes: Uint8Array): ImageMimeType | null {
  if (hasBytesAt(bytes, 0, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }

  if (hasBytesAt(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }

  if (hasBytesAt(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && asciiAt(bytes, 8, 4) === 'WEBP') {
    return 'image/webp';
  }

  // ISO-BMFF: a four-byte box size, then `ftyp`, then the brand that names the actual format.
  if (asciiAt(bytes, 4, 4) === 'ftyp') {
    const brand = asciiAt(bytes, 8, 4);

    if (HEIC_BRANDS.includes(brand)) {
      return 'image/heic';
    }

    return HEIF_BRANDS.includes(brand) ? 'image/heif' : null;
  }

  return null;
}

/**
 * What may be captured: the five image types, plus a PDF.
 *
 * A PDF's header is at offset 0 in every file a browser, a scanner or an accounting program produces.
 * The specification tolerates leading junk before `%PDF-`, and this sniffer does not: a file that is
 * not recognisable in its first five bytes is refused rather than guessed at, which is the same
 * fail-closed choice the image signatures make.
 */
export function detectDocumentMime(bytes: Uint8Array): DocumentMimeType | null {
  if (hasBytesAt(bytes, 0, PDF_SIGNATURE)) {
    return PDF_MIME_TYPE;
  }

  return detectImageMime(bytes);
}

export function isImageMimeType(value: unknown): value is ImageMimeType {
  return typeof value === 'string' && (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function isDocumentMimeType(value: unknown): value is DocumentMimeType {
  return typeof value === 'string' && (DOCUMENT_MIME_TYPES as readonly string[]).includes(value);
}

/** Storage extension for a sniffed type. Server-generated keys only — never the uploaded filename. */
export function extensionForImageMime(mimeType: ImageMimeType): string {
  return MIME_EXTENSIONS[mimeType];
}

/** The same, for anything `detectDocumentMime` can return. */
export function extensionForDocumentMime(mimeType: DocumentMimeType): string {
  return MIME_EXTENSIONS[mimeType];
}

/**
 * Reads a byte ceiling from configuration (`STORAGE_MAX_UPLOAD_BYTES`), falling back when it is absent
 * or nonsense. The grammar is digits only: `parseInt('8 MiB')` would happily return 8 and turn an
 * 8 MiB ceiling into an 8 *byte* one, so a value that is not purely a number is not read at all. A
 * ceiling is a security control, and a bad one fails closed (the default) rather than open.
 */
export function maxUploadBytesFrom(
  value: string | number | undefined,
  fallback: number = DEFAULT_MAX_UPLOAD_BYTES,
): number {
  if (value === undefined) {
    return fallback;
  }

  const text = typeof value === 'number' ? String(value) : value.trim();
  if (!/^\d+$/.test(text)) {
    return fallback;
  }

  const parsed = Number.parseInt(text, 10);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const UploadProblemCode = {
  /** Zero bytes: the camera cancelled, or the client sent an empty part. */
  EMPTY: 'EMPTY',
  /** The bytes are not one of the five accepted image formats. */
  UNSUPPORTED_TYPE: 'UNSUPPORTED_TYPE',
  /** Beyond the configured ceiling. */
  TOO_LARGE: 'TOO_LARGE',
} as const;

export type UploadProblemCode = (typeof UploadProblemCode)[keyof typeof UploadProblemCode];

export type UploadInspection =
  | {
      readonly ok: true;
      readonly byteSize: number;
      readonly mimeType: DocumentMimeType;
      readonly extension: string;
    }
  | {
      readonly ok: false;
      readonly byteSize: number;
      readonly code: UploadProblemCode;
      readonly message: string;
    };

/** The single decision point for an incoming document: one call, one answer, no partial states. */
export function inspectUpload(
  bytes: Uint8Array,
  options: { readonly maxBytes?: number } = {},
): UploadInspection {
  const byteSize = bytes.byteLength;

  if (byteSize === 0) {
    return { ok: false, byteSize, code: UploadProblemCode.EMPTY, message: 'skedari është bosh' };
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  if (byteSize > maxBytes) {
    return {
      ok: false,
      byteSize,
      code: UploadProblemCode.TOO_LARGE,
      message: `skedari ka ${String(byteSize)} bajt, më shumë se kufiri prej ${String(maxBytes)} bajtësh`,
    };
  }

  const mimeType = detectDocumentMime(bytes);
  if (mimeType === null) {
    return {
      ok: false,
      byteSize,
      code: UploadProblemCode.UNSUPPORTED_TYPE,
      message: 'skedari nuk është imazh JPEG, PNG, WebP, HEIC, HEIF ose PDF',
    };
  }

  return { ok: true, byteSize, mimeType, extension: extensionForDocumentMime(mimeType) };
}
