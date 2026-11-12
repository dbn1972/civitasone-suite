/**
 * GET /v1/citizen/applications/:id/documents/:docId/download - mint a short-lived presigned GET URL.
 *
 * Access: the applicant (own application only) and officers of the same tenant. The tenant is part of
 * the RLS-scoped lookup, a foreign application/document is a 404 (existence not leaked), and the key
 * is read from the row - never from the client.
 */
import type { RequestContext } from "@civitasone/types";
import { presignedGetUrl, objectExists } from "@civitasone/storage";
import { db } from "../../shared/db.js";
import { HttpError, assertOwnership } from "../../shared/context.js";
import * as repo from "./repo.js";
import { downloadTtlSeconds, keyBelongsToApplication } from "./docs-storage.js";

export interface DocumentDownload {
  downloadUrl: string;
  expiresIn: number;
  filename: string | null;
  contentType: string | null;
}

export async function presignDocumentDownload(ctx: RequestContext, applicationId: string, docId: string): Promise<DocumentDownload> {
  const app = await db.transaction((tx) => repo.findApplicationByIdTx(tx, applicationId, ctx.tenantId));
  if (!app) throw new HttpError(404, "NOT_FOUND", "application not found");
  assertOwnership(ctx, app.citizenId);

  const doc = await repo.findDocument(ctx.tenantId, applicationId, docId);
  if (!doc) throw new HttpError(404, "NOT_FOUND", "document not found");

  // Legacy rows carry a fabricated link and no object.
  if (!doc.storageKey || !keyBelongsToApplication(doc.storageKey, ctx.tenantId, applicationId)) {
    throw new HttpError(409, "DOCUMENT_NOT_AVAILABLE", "document not available");
  }
  let exists: boolean;
  try {
    exists = await objectExists(doc.storageKey);
  } catch {
    throw new HttpError(503, "STORAGE_UNAVAILABLE", "document storage could not be reached right now");
  }
  // Presigned but never PUT (aborted upload).
  if (!exists) throw new HttpError(409, "DOCUMENT_NOT_AVAILABLE", "document not available");

  const expiresIn = downloadTtlSeconds();
  const downloadUrl = await presignedGetUrl({ key: doc.storageKey, expiresIn });
  return { downloadUrl, expiresIn, filename: doc.originalFilename ?? null, contentType: doc.contentType ?? null };
}
