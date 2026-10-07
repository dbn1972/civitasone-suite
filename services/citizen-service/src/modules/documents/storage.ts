/**
 * GAP-CITIZEN-DOCUMENTS-01 — real object-storage upload for citizen documents.
 *
 * Mirrors the admin-service uploads presign pattern (SigV4 presigned PUT via
 * @civitasone/storage) but tenant/actor-namespaced for the citizen domain:
 * files live EXTERNALLY in S3/MinIO; only the opaque object key is ever stored
 * on the submission row (never the bytes). The uploader's id is baked into the
 * key so the confirm step can require that an attached object is the caller's
 * own upload, and the tenant prefix is the hard isolation boundary.
 */
import { randomUUID } from "node:crypto";
import {
  presignedPutUrl,
  presignedGetUrl,
  objectExists,
} from "@civitasone/storage";

/** Short-lived presigned URL TTLs (seconds). */
export const PUT_URL_TTL_SECONDS = 300;
export const GET_URL_TTL_SECONDS = 3600;

/**
 * Allowed document categories → max size + permitted extensions. A citizen
 * document is almost always a scan or photo of a certificate/ID, so the set is
 * deliberately tight (no office formats). The size cap is SIGNED into the URL
 * via contentLength, so the object store itself rejects an oversized body.
 */
export const DOCUMENT_UPLOAD_LIMITS: { maxSizeMb: number; extensions: string[]; contentTypes: string[] } = {
  maxSizeMb: 10,
  extensions: ["pdf", "jpg", "jpeg", "png", "webp", "heic"],
  contentTypes: [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
  ],
};

export function extensionOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export interface PresignValidationError {
  code: "INVALID_FILE_TYPE" | "FILE_TOO_LARGE";
  message: string;
}

/**
 * Validate a presign request against the citizen-document limits. Returns an
 * error descriptor (never throws) so the route can map it to a 400 with a
 * clear, applicant-facing message.
 */
export function validateUpload(input: {
  filename: string;
  contentType: string;
  sizeBytes: number;
}): PresignValidationError | null {
  const ext = extensionOf(input.filename);
  if (!DOCUMENT_UPLOAD_LIMITS.extensions.includes(ext)) {
    return {
      code: "INVALID_FILE_TYPE",
      message: `Allowed document types: ${DOCUMENT_UPLOAD_LIMITS.extensions.join(", ")}`,
    };
  }
  if (!DOCUMENT_UPLOAD_LIMITS.contentTypes.includes(input.contentType)) {
    return {
      code: "INVALID_FILE_TYPE",
      message: `Allowed content types: ${DOCUMENT_UPLOAD_LIMITS.contentTypes.join(", ")}`,
    };
  }
  const maxBytes = DOCUMENT_UPLOAD_LIMITS.maxSizeMb * 1024 * 1024;
  if (input.sizeBytes <= 0 || input.sizeBytes > maxBytes) {
    return {
      code: "FILE_TOO_LARGE",
      message: `File must be between 1 byte and ${DOCUMENT_UPLOAD_LIMITS.maxSizeMb} MB`,
    };
  }
  return null;
}

/**
 * Tenant + actor namespaced object key:
 *   citizen-documents/<tenant>/<actor>/<uuid>.<ext>
 * The <uuid> makes every presign land on a distinct key (no clobber); the
 * tenant prefix is the isolation boundary; the actor segment lets confirm
 * assert the object was uploaded by this caller.
 */
export function buildStorageKey(tenantId: string, actorId: string, filename: string): string {
  const ext = extensionOf(filename);
  return `citizen-documents/${tenantId}/${actorId}/${randomUUID()}${ext ? `.${ext}` : ""}`;
}

/** The prefix a key MUST start with to be accepted at confirm time. */
export function tenantActorPrefix(tenantId: string, actorId: string): string {
  return `citizen-documents/${tenantId}/${actorId}/`;
}

/** True when the key is well-formed for this tenant+actor (anti-forgery check). */
export function keyBelongsToCaller(key: string, tenantId: string, actorId: string): boolean {
  return key.startsWith(tenantActorPrefix(tenantId, actorId));
}

export { presignedPutUrl, presignedGetUrl, objectExists };
