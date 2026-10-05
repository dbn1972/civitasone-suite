/**
 * FilingPort implementation for bulk-scan: creates / soft-deletes documents in the files module's own tables.
 * Lives HERE (not in bulk-scan) so bulk-scan never imports files/repo.ts or files/schema.ts; the composition root
 * (worker.ts, tests) injects it with setPorts({ filing }).
 *
 * Idempotent: the document id is deterministic per scanned file (the caller derives it), rows are inserted with
 * ON CONFLICT DO NOTHING, so a redelivered filing command creates nothing twice.
 */
import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { FilingInput, FilingPort } from "../bulk-scan/ports.js";
import type { db } from "../../shared/db.js";
import { files, fileVersions } from "./schema.js";

type Tx = Pick<typeof db, "insert" | "update">;

export function createFilingAdapter(): FilingPort {
  return {
    async create(rawTx, i: FilingInput): Promise<boolean> {
      const tx = rawTx as Tx;
      const inserted = await tx.insert(files).values({
        id: i.documentId, tenantId: i.tenantId, folderId: i.folderId, name: i.name, mimeType: i.mimeType, sizeBytes: i.sizeBytes,
        storageKey: i.originalKey, tags: i.tags, status: "active", version: 1, createdBy: i.actorId, updatedBy: i.actorId,
      }).onConflictDoNothing({ target: files.id }).returning({ id: files.id });
      if (inserted.length === 0) return false;                       // already filed (redelivery)

      // Version 1: the original plus its renditions (one row per kind, same version number).
      const rows: (typeof fileVersions.$inferInsert)[] = [
        { id: randomUUID(), fileId: i.documentId, tenantId: i.tenantId, version: 1, storageKey: i.originalKey, sizeBytes: i.sizeBytes, kind: "original", createdBy: i.actorId },
      ];
      if (i.searchablePdfKey) rows.push({ id: randomUUID(), fileId: i.documentId, tenantId: i.tenantId, version: 1, storageKey: i.searchablePdfKey, sizeBytes: null, kind: "searchable_pdf", createdBy: i.actorId });
      if (i.textKey) rows.push({ id: randomUUID(), fileId: i.documentId, tenantId: i.tenantId, version: 1, storageKey: i.textKey, sizeBytes: null, kind: "ocr_text", createdBy: i.actorId });
      if (i.structuredJsonKey) rows.push({ id: randomUUID(), fileId: i.documentId, tenantId: i.tenantId, version: 1, storageKey: i.structuredJsonKey, sizeBytes: null, kind: "structured_json", createdBy: i.actorId });
      await tx.insert(fileVersions).values(rows).onConflictDoNothing();
      return true;
    },

    async markDeleted(rawTx, a): Promise<boolean> {
      const tx = rawTx as Tx;
      const rows = await tx.update(files)
        .set({ deletedAt: new Date(), status: "deleted", updatedBy: a.actorId, updatedAt: new Date() })
        .where(and(eq(files.tenantId, a.tenantId), eq(files.id, a.documentId), isNull(files.deletedAt)))
        .returning({ id: files.id });
      return rows.length > 0;
    },
  };
}
