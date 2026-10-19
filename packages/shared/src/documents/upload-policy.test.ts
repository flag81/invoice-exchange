import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_UPLOAD_BYTES,
  DOCUMENT_MIME_TYPES,
  IMAGE_MIME_TYPES,
  PDF_MIME_TYPE,
  UploadProblemCode,
  detectDocumentMime,
  detectImageMime,
  extensionForDocumentMime,
  extensionForImageMime,
  inspectUpload,
  isDocumentMimeType,
  isImageMimeType,
  maxUploadBytesFrom,
} from './upload-policy';

/** Minimal byte sequences with the right magic numbers — the point of the module is exactly this. */
const bytes = {
  jpeg: Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46),
  png: Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00),
  webp: Uint8Array.of(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50),
  heic: Uint8Array.of(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63),
  heif: Uint8Array.of(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31),
  avif: Uint8Array.of(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66),
  /** A 3GP video: `ftyp` with a brand no image reader accepts. */
  video: Uint8Array.of(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32),
  pdf: Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37),
  text: Uint8Array.of(0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64),
  empty: new Uint8Array(0),
  /** A RIFF container that is a WAV, not a WebP. */
  wav: Uint8Array.of(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45),
};

describe('detectImageMime', () => {
  it('recognises the five formats a phone camera or a screenshot produces', () => {
    expect(detectImageMime(bytes.jpeg)).toBe('image/jpeg');
    expect(detectImageMime(bytes.png)).toBe('image/png');
    expect(detectImageMime(bytes.webp)).toBe('image/webp');
    expect(detectImageMime(bytes.heic)).toBe('image/heic');
    expect(detectImageMime(bytes.heif)).toBe('image/heif');
  });

  it('maps the AVIF brand to HEIF, since AVIF is a HEIF container', () => {
    expect(detectImageMime(bytes.avif)).toBe('image/heif');
  });

  it('refuses a PDF, a text file and a video that were renamed to .jpg', () => {
    expect(detectImageMime(bytes.pdf)).toBeNull();
    expect(detectImageMime(bytes.text)).toBeNull();
    expect(detectImageMime(bytes.video)).toBeNull();
  });

  it('does not mistake another RIFF container for a WebP', () => {
    expect(detectImageMime(bytes.wav)).toBeNull();
  });

  it('handles a buffer shorter than the signature instead of reading past the end', () => {
    expect(detectImageMime(bytes.empty)).toBeNull();
    expect(detectImageMime(Uint8Array.of(0xff, 0xd8))).toBeNull();
    expect(detectImageMime(Uint8Array.of(0x52, 0x49, 0x46, 0x46))).toBeNull();
    expect(detectImageMime(Uint8Array.of(0x00, 0x00, 0x00, 0x18, 0x66, 0x74))).toBeNull();
  });
});

describe('isImageMimeType', () => {
  it('accepts every supported type and rejects anything else', () => {
    for (const mimeType of IMAGE_MIME_TYPES) {
      expect(isImageMimeType(mimeType)).toBe(true);
    }

    expect(isImageMimeType('image/gif')).toBe(false);
    expect(isImageMimeType('IMAGE/JPEG')).toBe(false);
    expect(isImageMimeType(undefined)).toBe(false);
    expect(isImageMimeType(42)).toBe(false);
  });
});

describe('detectDocumentMime', () => {
  it('recognises a PDF from its header, the way it recognises an image', () => {
    expect(detectDocumentMime(bytes.pdf)).toBe(PDF_MIME_TYPE);
    expect(detectDocumentMime(Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe(PDF_MIME_TYPE);
  });

  it('still recognises every image, so one sniffer decides both kinds of input', () => {
    for (const image of [bytes.jpeg, bytes.png, bytes.webp, bytes.heic, bytes.heif]) {
      expect(detectDocumentMime(image)).not.toBeNull();
      expect(detectDocumentMime(image)).not.toBe(PDF_MIME_TYPE);
    }
  });

  it('refuses text, a video and a PDF header that is not at the start', () => {
    expect(detectDocumentMime(bytes.text)).toBeNull();
    expect(detectDocumentMime(bytes.video)).toBeNull();
    // `%PDF-` preceded by junk: the specification allows it, this sniffer does not guess.
    expect(detectDocumentMime(Uint8Array.of(0x00, 0x00, 0x25, 0x50, 0x44, 0x46, 0x2d))).toBeNull();
    expect(detectDocumentMime(Uint8Array.of(0x25, 0x50, 0x44))).toBeNull();
    expect(detectDocumentMime(bytes.empty)).toBeNull();
  });
});

describe('isDocumentMimeType', () => {
  it('accepts every document type and rejects anything else', () => {
    for (const mimeType of DOCUMENT_MIME_TYPES) {
      expect(isDocumentMimeType(mimeType)).toBe(true);
    }

    expect(isDocumentMimeType(PDF_MIME_TYPE)).toBe(true);
    expect(isDocumentMimeType('application/zip')).toBe(false);
    expect(isDocumentMimeType('APPLICATION/PDF')).toBe(false);
    expect(isDocumentMimeType(undefined)).toBe(false);
  });

  it('does not widen the image set with a PDF', () => {
    expect(isImageMimeType(PDF_MIME_TYPE)).toBe(false);
  });
});

describe('extensionForImageMime', () => {
  it('gives a storage extension for each accepted type', () => {
    expect(extensionForImageMime('image/jpeg')).toBe('jpg');
    expect(extensionForImageMime('image/png')).toBe('png');
    expect(extensionForImageMime('image/webp')).toBe('webp');
    expect(extensionForImageMime('image/heic')).toBe('heic');
    expect(extensionForImageMime('image/heif')).toBe('heif');
  });
});

describe('extensionForDocumentMime', () => {
  it('gives the same image extensions, plus one for a PDF', () => {
    expect(extensionForDocumentMime('image/jpeg')).toBe('jpg');
    expect(extensionForDocumentMime(PDF_MIME_TYPE)).toBe('pdf');
  });
});

describe('maxUploadBytesFrom', () => {
  it('reads a sane configured ceiling', () => {
    expect(maxUploadBytesFrom('1048576')).toBe(1_048_576);
    expect(maxUploadBytesFrom(2048)).toBe(2048);
  });

  it('falls back rather than treating nonsense as "accept anything"', () => {
    expect(maxUploadBytesFrom(undefined)).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    expect(maxUploadBytesFrom('')).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    expect(maxUploadBytesFrom('8 MiB')).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    expect(maxUploadBytesFrom('0')).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    expect(maxUploadBytesFrom('-10')).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    expect(maxUploadBytesFrom(1.5)).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    expect(maxUploadBytesFrom('123abc')).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    expect(maxUploadBytesFrom(' ')).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });

  it('accepts an explicit fallback for callers with their own ceiling', () => {
    expect(maxUploadBytesFrom(undefined, 512)).toBe(512);
  });
});

describe('inspectUpload', () => {
  it('accepts an image, naming the type and the extension it will be stored under', () => {
    const inspection = inspectUpload(bytes.png);

    expect(inspection).toEqual({
      ok: true,
      byteSize: bytes.png.byteLength,
      mimeType: 'image/png',
      extension: 'png',
    });
  });

  it('reports an empty part as EMPTY, which is a cancelled picker, not an error worth a stack trace', () => {
    const inspection = inspectUpload(bytes.empty);

    expect(inspection.ok).toBe(false);
    expect(inspection).toMatchObject({ code: UploadProblemCode.EMPTY, byteSize: 0 });
  });

  it('reports a file over the ceiling as TOO_LARGE, before sniffing it', () => {
    const inspection = inspectUpload(bytes.png, { maxBytes: 4 });

    expect(inspection.ok).toBe(false);
    expect(inspection).toMatchObject({ code: UploadProblemCode.TOO_LARGE, byteSize: 10 });
  });

  it('accepts a PDF, storing it under .pdf and never converting it', () => {
    const inspection = inspectUpload(bytes.pdf);

    expect(inspection).toEqual({
      ok: true,
      byteSize: bytes.pdf.byteLength,
      mimeType: PDF_MIME_TYPE,
      extension: 'pdf',
    });
  });

  it('reports a file that is neither a photo nor a PDF as UNSUPPORTED_TYPE', () => {
    const inspection = inspectUpload(bytes.text);

    expect(inspection.ok).toBe(false);
    expect(inspection).toMatchObject({ code: UploadProblemCode.UNSUPPORTED_TYPE });
    expect(inspection.ok ? '' : inspection.message).toContain('JPEG');
    expect(inspection.ok ? '' : inspection.message).toContain('PDF');
  });

  it('uses the default ceiling when the caller does not pass one', () => {
    expect(inspectUpload(bytes.jpeg).ok).toBe(true);
  });
});
