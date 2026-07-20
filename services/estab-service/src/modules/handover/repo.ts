import { eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabChargeHandover } from "./schema.js";
import type { HandoverRow, HandoverInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function findHandoverById(id: string, tenantId: string): Promise<HandoverRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(estabChargeHandover)
    .where(eq(estabChargeHandover.id, id)).limit(1));
  const row = rows[0];
  return row && row.tenantId === tenantId ? row : null;
}

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function listHandovers(tenantId: string, limit: number): Promise<HandoverRow[]> {
  return db.transaction((tx) => tx.select().from(estabChargeHandover)
    .where(eq(estabChargeHandover.tenantId, tenantId))
    .orderBy(desc(estabChargeHandover.createdAt))
    .limit(limit));
}

export async function insertHandover(tx: Writer, row: HandoverInsert): Promise<void> {
  await tx.insert(estabChargeHandover).values(row);
}

export async function updateHandover(tx: Writer, id: string, patch: Partial<HandoverInsert>): Promise<void> {
  await tx.update(estabChargeHandover).set({ ...patch, updatedAt: new Date() }).where(eq(estabChargeHandover.id, id));
}
