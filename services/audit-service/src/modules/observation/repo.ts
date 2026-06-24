import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { auditObservations, type ObservationRow, type ObservationInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findObservationById(id: string, tenantId: string): Promise<ObservationRow | null> {
  const rows = await db.select().from(auditObservations).where(and(eq(auditObservations.id, id), eq(auditObservations.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findObservationByIdTx(tx: Writer, id: string, tenantId: string): Promise<ObservationRow | null> {
  const rows = await (tx as typeof db).select().from(auditObservations).where(and(eq(auditObservations.id, id), eq(auditObservations.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function insertObservation(tx: Writer, row: ObservationInsert): Promise<void> {
  await tx.insert(auditObservations).values(row);
}

/** Optimistic-locked, tenant-scoped update. Returns rows affected (0 = stale version / not found). */
export async function updateObservationVersioned(tx: Writer, id: string, tenantId: string, expectedVersion: number, patch: Partial<ObservationInsert>): Promise<number> {
  const res = await tx.update(auditObservations)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(auditObservations.id, id), eq(auditObservations.tenantId, tenantId), eq(auditObservations.version, expectedVersion)))
    .returning({ id: auditObservations.id });
  return res.length;
}

export async function listObservationsByTenant(tenantId: string, limit: number): Promise<ObservationRow[]> {
  return db.select().from(auditObservations)
    .where(eq(auditObservations.tenantId, tenantId))
    .limit(limit);
}
