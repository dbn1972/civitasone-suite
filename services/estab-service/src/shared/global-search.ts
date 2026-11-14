/**
 * Establishment files -> cross-module search. Indexed: file number, subject, department name, status.
 * NOT indexed: notings, correspondence, attachments, holder, VIP/parliament references.
 *
 * Classification: file access in estab-service depends on each officer's clearance, which an index cannot mirror. So only
 * `public`, non-VIP files are indexed; a file that is (or becomes) confidential, secret, top secret or VIP is published as
 * a REMOVAL. Flag off for the tenant => returns before any query.
 */
import { and, asc, eq, gt } from "drizzle-orm";
import { syncGlobalRecord, type BackfillEntity, type DrizzleTx, type SearchableFields } from "@civitasone/search";
import { estabFiles } from "../modules/files/schema.js";
import type { db } from "./db.js";

type Reader = Pick<typeof db, "select">;

const cols = {
  id: estabFiles.id, tenantId: estabFiles.tenantId, updatedBy: estabFiles.updatedBy, fileNo: estabFiles.fileNo, subject: estabFiles.subject,
  dept: estabFiles.dept, status: estabFiles.status, classification: estabFiles.classification, isVip: estabFiles.isVip,
};
type Row = { fileNo: string; subject: string; dept: string; status: string; classification: string; isVip: boolean };
export const fileFields = (r: Row): SearchableFields | null =>
  r.classification !== "public" || r.isVip ? null : { title: r.subject, refNumber: r.fileNo, status: r.status, summary: r.dept };

export async function syncFile(tx: Reader, id: string, tenantId?: string): Promise<void> {
  await syncGlobalRecord({
    tx: tx as unknown as DrizzleTx, entityType: "estab.file", entityId: id, tenantId,
    load: async () => (await tx.select(cols).from(estabFiles)
      .where(tenantId ? and(eq(estabFiles.id, id), eq(estabFiles.tenantId, tenantId)) : eq(estabFiles.id, id)).limit(1))[0],
    toRecord: fileFields,
  });
}

export function backfillEntities(tenantId: string, withTenant: <T>(fn: (tx: Reader) => Promise<T>) => Promise<T>): BackfillEntity[] {
  return [{
    entityType: "estab.file",
    source: {
      tenantId, idOf: (r: { id: string }) => r.id,
      fetchPage: (after: string | null, size: number) => withTenant((tx) => tx.select(cols).from(estabFiles)
        .where(and(eq(estabFiles.tenantId, tenantId), after ? gt(estabFiles.id, after) : undefined)).orderBy(asc(estabFiles.id)).limit(size)),
      toRecord: (r: Row & { id: string }) => { const f = fileFields(r); return f ? { ...f, entityType: "estab.file" as const, entityId: r.id, tenantId } : null; },
    },
  }];
}
