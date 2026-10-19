import { DocumentKind, recordDocument } from '@einv/db';
import { PDF_MIME_TYPE, UploadProblemCode, inspectUpload, maxUploadBytesFrom } from '@einv/shared';

import { sq } from '@/lib/copy/sq';
import { serverEnv } from '@/lib/env';
import { requireActor } from '@/server/auth/session';
import { jsonResponse, toErrorResponse } from '@/server/http';
import {
  buildStorageKey,
  newStorageId,
  putObject,
  sha256Hex,
  storagePeriod,
} from '@/server/storage/local-storage';

/**
 * `POST /api/documents` — the upload endpoint. One document in (a photo or a PDF), one
 * `document_blobs` row out.
 *
 * What it checks, and why each check is here rather than on the client:
 *
 *   * **The type comes from the bytes.** `inspectUpload` sniffs the magic number — `%PDF-` for a PDF,
 *     the container signature for an image; the browser-declared `Content-Type` is stored for nothing
 *     and trusted for nothing (ADR 0004, decision 6).
 *   * **The size ceiling is the server's.** `STORAGE_MAX_UPLOAD_BYTES` is read with a digits-only
 *     grammar, so a mistyped value cannot quietly become "accept anything". It applies to both kinds
 *     of input, since the bytes are buffered in the same request either way.
 *   * **The key is generated here.** `companyId/yyyy/mm/uuid.ext`; the uploaded filename is kept only
 *     as a display string, and never touches a path.
 *   * **The row is written before the answer is returned.** A file with no row is garbage (ADR 0004),
 *     so the index is part of the upload, not a follow-up.
 *   * **The kind records which of the two it was.** A PDF is not a "source image": support questions
 *     start with "what did they actually send?", and the row answers it without opening the file.
 *
 * The `local` driver is the only one implemented in the MVP; `STORAGE_DRIVER=s3` is refused loudly
 * rather than silently writing to the filesystem of whichever machine happens to serve the request.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireActor(request);
    const env = serverEnv();

    if (env.STORAGE_DRIVER !== 'local') {
      return jsonResponse(
        {
          error: {
            code: 'STORAGE_DRIVER_UNSUPPORTED',
            message: sq.api.storageDriver(env.STORAGE_DRIVER),
          },
        },
        501,
      );
    }

    const form = await request.formData().catch(() => null);
    if (form === null) {
      return jsonResponse(
        {
          error: {
            code: 'INVALID_UPLOAD',
            message: sq.api.multipartRequired,
          },
        },
        400,
      );
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      return jsonResponse({ error: { code: 'INVALID_UPLOAD', message: sq.api.noFilePart } }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const inspection = inspectUpload(bytes, {
      maxBytes: maxUploadBytesFrom(env.STORAGE_MAX_UPLOAD_BYTES),
    });

    if (!inspection.ok) {
      return jsonResponse(
        { error: { code: inspection.code, message: inspection.message } },
        inspection.code === UploadProblemCode.TOO_LARGE ? 413 : 400,
      );
    }

    const tenant = actor.tenant;
    const period = storagePeriod(new Date());
    const storageKey = buildStorageKey({
      companyId: tenant.companyId,
      year: period.year,
      month: period.month,
      id: newStorageId(),
      extension: inspection.extension,
    });

    await putObject(env.STORAGE_LOCAL_ROOT, storageKey, bytes);

    const document = await recordDocument({
      companyId: tenant.companyId,
      kind:
        inspection.mimeType === PDF_MIME_TYPE ? DocumentKind.SOURCE_PDF : DocumentKind.SOURCE_IMAGE,
      storageDriver: env.STORAGE_DRIVER,
      storageKey,
      mimeType: inspection.mimeType,
      byteSize: inspection.byteSize,
      sha256: sha256Hex(bytes),
      originalFilename: file.name === '' ? null : file.name,
    });

    return jsonResponse(
      {
        documentId: document.id,
        mimeType: document.mimeType,
        byteSize: document.byteSize,
        sha256: document.sha256,
        originalFilename: document.originalFilename,
        uploadedAt: document.createdAt.toISOString(),
      },
      201,
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
