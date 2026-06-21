import { eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { auditExports, type ExportInsert, type ExportRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertExport(tx: Writer, row: ExportInsert): Promise<void> {
  await tx.insert(auditExports).values(row);
}

export async function listExportsByTenant(tenantId: string, limit: number): Promise<ExportRow[]> {
  return db.select().from(auditExports)
    .where(eq(auditExports.tenantId, tenantId))
    .orderBy(desc(auditExports.createdAt))
    .limit(limit);
}
