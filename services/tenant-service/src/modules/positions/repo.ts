/**
 * positions repository (CAP-014/015). All reads run under the tenant GUC so
 * FORCED RLS returns the tenant's sanctioned posts and role mappings.
 */
import { and, eq, asc } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { positions, positionRoleMap, type PositionRow, type PositionRoleRow } from "./schema.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
}

export function listPositions(tenantId: string): Promise<PositionRow[]> {
  return scoped(tenantId, (tx) => tx.select().from(positions).where(eq(positions.tenantId, tenantId)).orderBy(positions.title));
}

export function findPosition(tenantId: string, id: string): Promise<PositionRow | undefined> {
  return scoped(tenantId, (tx) => findPositionTx(tx, tenantId, id));
}

export async function findPositionTx(tx: Tx, tenantId: string, id: string): Promise<PositionRow | undefined> {
  const rows = await tx.select().from(positions).where(and(eq(positions.id, id), eq(positions.tenantId, tenantId))).limit(1);
  return rows[0];
}

export function listRoles(tenantId: string, positionId: string): Promise<PositionRoleRow[]> {
  return scoped(tenantId, (tx) => tx.select().from(positionRoleMap)
    .where(and(eq(positionRoleMap.tenantId, tenantId), eq(positionRoleMap.positionId, positionId)))
    .orderBy(asc(positionRoleMap.roleKey)));
}

export async function insertPosition(tx: Tx, data: typeof positions.$inferInsert): Promise<void> {
  await tx.insert(positions).values(data);
}
export async function insertRole(tx: Tx, data: typeof positionRoleMap.$inferInsert): Promise<void> {
  await tx.insert(positionRoleMap).values(data).onConflictDoNothing();
}
