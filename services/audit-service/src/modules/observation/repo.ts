import { and, eq, sql } from "drizzle-orm";
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

// C1/M1: a "closed" transition is only allowed when the observation has no
// outstanding work. Returns the number of blocking rows:
//   - paras for this observation whose status is not yet "closed"
//   - pending-register rows (joined via para_id) that are still unsettled
//     (status not in "settled"/"closed").
// Tenant-scoped; runs inside the close transaction (Writer = tx).
export async function countOpenBlockers(tx: Writer, observationId: string, tenantId: string): Promise<number> {
  const rows = await (tx as typeof db).execute(sql`
    SELECT (
      (SELECT count(*) FROM para.audit_paras p
         WHERE p.tenant_id = ${tenantId}
           AND p.observation_id = ${observationId}
           AND p.status <> 'closed')
      +
      (SELECT count(*) FROM compliance.audit_pending_register r
         JOIN para.audit_paras p2 ON p2.id = r.para_id
         WHERE r.tenant_id = ${tenantId}
           AND p2.observation_id = ${observationId}
           AND r.status NOT IN ('settled', 'closed'))
    )::int AS blockers
  `);
  const list = (rows as unknown as { rows?: Array<{ blockers: number }> }).rows ?? (rows as unknown as Array<{ blockers: number }>);
  return Number(list?.[0]?.blockers ?? 0);
}
