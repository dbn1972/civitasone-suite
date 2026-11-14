/**
 * Confirmed-upload state. A document row exists from the moment the presigned PUT is issued, so
 * `available` must not be true until the object is really there. The first read that finds the object
 * (HEAD) persists confirmed_at; later reads need no HEAD. A store error leaves the row unconfirmed
 * (reported UPLOAD_PENDING) and is never fatal to the application read.
 */
import { objectExists } from "@civitasone/storage";
import * as repo from "./repo.js";
import type { citizenAppDocuments } from "./schema.js";

type DocRow = typeof citizenAppDocuments.$inferSelect;

export async function confirmUploads(tenantId: string, rows: DocRow[]): Promise<DocRow[]> {
  return Promise.all(rows.map(async (row) => {
    if (!row.storageKey || row.confirmedAt) return row;
    try {
      if (!(await objectExists(row.storageKey))) return row;
      await repo.markDocumentConfirmed(tenantId, row.id);
      return { ...row, confirmedAt: new Date() };
    } catch {
      return row;
    }
  }));
}
