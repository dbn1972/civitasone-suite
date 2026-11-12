/**
 * Application documents on real object storage.
 *
 * Objects live in S3/MinIO (bucket from AWS_S3_BUCKET via @civitasone/storage); the DB row keeps only
 * the opaque OBJECT KEY. Keys are tenant + application namespaced:
 *   citizen-documents/<tenant>/applications/<application>/<uuid>.<ext>
 * so the tenant prefix is the hard isolation boundary and a download is only ever minted for a key
 * read from a row that passed the tenant + ownership checks (a client never supplies a key).
 */
import { randomUUID } from "node:crypto";
import { extensionOf } from "../documents/storage.js";

/** Short-lived download URL lifetime (seconds). Override with CITIZEN_DOC_DOWNLOAD_TTL_SECONDS (30..3600). */
export function downloadTtlSeconds(): number {
  const n = Number(process.env.CITIZEN_DOC_DOWNLOAD_TTL_SECONDS);
  return Number.isFinite(n) && n >= 30 && n <= 3600 ? Math.floor(n) : 300;
}

export function applicationDocumentPrefix(tenantId: string, applicationId: string): string {
  return `citizen-documents/${tenantId}/applications/${applicationId}/`;
}

export function buildApplicationDocumentKey(tenantId: string, applicationId: string, filename: string): string {
  const ext = extensionOf(filename);
  return `${applicationDocumentPrefix(tenantId, applicationId)}${randomUUID()}${ext ? `.${ext}` : ""}`;
}

/** True only for a key inside this tenant + application's prefix (defence in depth before signing). */
export function keyBelongsToApplication(key: string, tenantId: string, applicationId: string): boolean {
  return key.startsWith(applicationDocumentPrefix(tenantId, applicationId)) && !key.includes("..");
}

export interface DocumentRowLike {
  id: string;
  applicationId: string;
  docType: string;
  uploadedAt: Date | string;
  storageKey?: string | null;
  contentType?: string | null;
  sizeBytes?: number | string | null;
  originalFilename?: string | null;
  confirmedAt?: Date | string | null;
}

/** Content types a file extension may be uploaded as (the citizen document allow-list). */
export const EXTENSION_CONTENT_TYPES: Record<string, readonly string[]> = {
  pdf: ["application/pdf"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  heic: ["image/heic"],
};

/** Null when the filename extension agrees with the declared content type, else a clear message. */
export function extensionContentTypeMismatch(filename: string, contentType: string): string | null {
  const ext = extensionOf(filename);
  const allowed = EXTENSION_CONTENT_TYPES[ext];
  if (!allowed || allowed.includes(contentType)) return null; // unknown ext is rejected by validateUpload
  return `File extension .${ext} does not match content type ${contentType} (expected ${allowed.join(" or ")})`;
}

/**
 * API view of a document row. NEVER exposes the storage key or any URL.
 * available=true only once the object is confirmed to exist (HEAD succeeded); a presigned-but-not-yet-
 * uploaded row is `UPLOAD_PENDING`, a legacy row (fabricated link, no object) is `DOCUMENT_NOT_AVAILABLE`.
 */
export function toDocumentView(row: DocumentRowLike) {
  const hasKey = typeof row.storageKey === "string" && row.storageKey.length > 0;
  const available = hasKey && row.confirmedAt != null;
  return {
    id: row.id,
    docType: row.docType,
    uploadedAt: row.uploadedAt instanceof Date ? row.uploadedAt.toISOString() : String(row.uploadedAt),
    filename: row.originalFilename ?? null,
    contentType: row.contentType ?? null,
    sizeBytes: row.sizeBytes == null ? null : Number(row.sizeBytes),
    available,
    downloadPath: available ? `/v1/citizen/applications/${row.applicationId}/documents/${row.id}/download` : null,
    ...(available ? {} : { unavailableReason: hasKey ? "UPLOAD_PENDING" : "DOCUMENT_NOT_AVAILABLE" }),
  };
}
