import { and, eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { auditExports, type ExportInsert, type ExportRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertExport(tx: Writer, row: ExportInsert): Promise<void> {
  await tx.insert(auditExports).values(row);
}

export async function findByIdTx(tx: Writer, id: string, tenantId: string): Promise<ExportRow | null> {
  const rows = await (tx as typeof db).select().from(auditExports)
    .where(and(eq(auditExports.id, id), eq(auditExports.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findByToken(tenantId: string, token: string): Promise<ExportRow | null> {
  const rows = await db.select().from(auditExports)
    .where(and(eq(auditExports.tenantId, tenantId), eq(auditExports.downloadToken, token))).limit(1);
  return rows[0] ?? null;
}

/** Optimistic-locked completion: only flips a still-'pending' row. Returns rows affected. */
export async function completeExportVersioned(
  tx: Writer, id: string, tenantId: string, expectedVersion: number, patch: Partial<ExportInsert>,
): Promise<number> {
  const res = await tx.update(auditExports)
    .set({ ...patch, status: "completed", updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(
      eq(auditExports.id, id), eq(auditExports.tenantId, tenantId),
      eq(auditExports.version, expectedVersion), eq(auditExports.status, "pending"),
    ))
    .returning({ id: auditExports.id });
  return res.length;
}

export async function failExportVersioned(
  tx: Writer, id: string, tenantId: string, expectedVersion: number, error: string,
): Promise<number> {
  const res = await tx.update(auditExports)
    .set({ status: "failed", error, updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(
      eq(auditExports.id, id), eq(auditExports.tenantId, tenantId),
      eq(auditExports.version, expectedVersion), eq(auditExports.status, "pending"),
    ))
    .returning({ id: auditExports.id });
  return res.length;
}

export async function listExportsByTenant(tenantId: string, limit: number): Promise<ExportRow[]> {
  return db.select().from(auditExports)
    .where(eq(auditExports.tenantId, tenantId))
    .orderBy(desc(auditExports.createdAt))
    .limit(limit);
}
