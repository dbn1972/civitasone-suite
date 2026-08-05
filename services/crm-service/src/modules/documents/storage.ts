/**
 * DM-001/003 storage adapter for the documents module.
 *
 * Files live EXTERNALLY in S3 (real SigV4 via @civitasone/storage); only the
 * metadata row lives in crm.documents. This thin wrapper owns:
 *   • the tenant-namespaced key layout, so one tenant can never presign into
 *     another's prefix, and
 *   • re-exports of the presign / existence / delete primitives so routes and
 *     consumers depend on one seam (easy to stub in tests).
 */
import { randomUUID } from "node:crypto";
import {
  presignedPutUrl,
  presignedGetUrl,
  objectExists,
  deleteObject,
} from "@civitasone/storage";

/** Seconds a PUT / GET presigned URL stays valid — short by design. */
export const PUT_URL_TTL_SECONDS = 300;
export const GET_URL_TTL_SECONDS = 300;

/**
 * Build a tenant-namespaced object key:
 *   crm/<tenant>/<subject>/<uuid>/<filename>
 * The <uuid> makes every upload attempt land on a distinct key (no clobber),
 * and the tenant prefix is the isolation boundary in the bucket.
 */
export function buildStorageKey(
  tenantId: string,
  subjectType: string,
  subjectId: string,
  filename: string,
): string {
  const safeName = filename.replace(/[^A-Za-z0-9._-]+/gu, "_");
  return `crm/${tenantId}/${subjectType}/${subjectId}/${randomUUID()}/${safeName}`;
}

/** The tenant prefix a key MUST start with to be accepted at confirm time. */
export function tenantPrefix(tenantId: string): string {
  return `crm/${tenantId}/`;
}

export { presignedPutUrl, presignedGetUrl, objectExists, deleteObject };
