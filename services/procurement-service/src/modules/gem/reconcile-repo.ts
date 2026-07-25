import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementGemIntegrationRefs, type GemRefRow, type GemRefInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertRef(tx: Writer, row: GemRefInsert): Promise<void> {
  await tx.insert(procurementGemIntegrationRefs).values(row);
}

export async function updateRef(tx: Writer, id: string, patch: Partial<GemRefInsert>): Promise<void> {
  await tx.update(procurementGemIntegrationRefs).set({ ...patch, updatedAt: new Date() }).where(eq(procurementGemIntegrationRefs.id, id));
}

export async function findRefByIdTx(tx: Writer, id: string, tenantId: string): Promise<GemRefRow | null> {
  const rows = await (tx as typeof db).select().from(procurementGemIntegrationRefs)
    .where(and(eq(procurementGemIntegrationRefs.id, id), eq(procurementGemIntegrationRefs.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findRefById(id: string, tenantId: string): Promise<GemRefRow | null> {
  return db.transaction((tx) => findRefByIdTx(tx, id, tenantId));
}

export async function listRefsByTenant(tenantId: string, limit = 100, offset = 0): Promise<GemRefRow[]> {
  return db.transaction((tx) => tx.select().from(procurementGemIntegrationRefs)
    .where(eq(procurementGemIntegrationRefs.tenantId, tenantId)).limit(limit).offset(offset));
}
