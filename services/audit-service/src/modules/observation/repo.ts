import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  auditObservations, auditObservationReplies,
  type ObservationRow, type ObservationInsert, type ObservationReplyRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findObservationById(id: string, tenantId: string): Promise<ObservationRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(auditObservations).where(and(eq(auditObservations.id, id), eq(auditObservations.tenantId, tenantId))).limit(1));
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
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(auditObservations)
    .where(eq(auditObservations.tenantId, tenantId))
    .limit(limit));
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

export async function insertReply(tx: Writer, row: typeof auditObservationReplies.$inferInsert): Promise<void> {
  await tx.insert(auditObservationReplies).values(row);
}

/** Stamp the auditor's accept/reject decision on the most recent reply (tenant-scoped). */
export async function recordLatestReplyDecision(
  tx: Writer, observationId: string, tenantId: string,
  decision: "accepted" | "rejected", remarks: string | null, actorId: string,
): Promise<void> {
  const latest = await (tx as typeof db).select({ id: auditObservationReplies.id }).from(auditObservationReplies)
    .where(and(eq(auditObservationReplies.observationId, observationId), eq(auditObservationReplies.tenantId, tenantId)))
    .orderBy(desc(auditObservationReplies.createdAt)).limit(1);
  const id = latest[0]?.id;
  if (!id) return;
  await tx.update(auditObservationReplies)
    .set({ decision, decisionRemarks: remarks, updatedAt: new Date(), updatedBy: actorId })
    .where(and(eq(auditObservationReplies.id, id), eq(auditObservationReplies.tenantId, tenantId)));
}

export async function listReplies(observationId: string, tenantId: string): Promise<ObservationReplyRow[]> {
  return db.transaction((tx) => tx.select().from(auditObservationReplies)
    .where(and(eq(auditObservationReplies.observationId, observationId), eq(auditObservationReplies.tenantId, tenantId)))
    .orderBy(asc(auditObservationReplies.createdAt)));
}

/** Plan period + latest para number for a batch of observations (tenant-scoped, one round trip each). */
export async function lookupPlanPeriods(tenantId: string, planIds: string[]): Promise<Map<string, { from: string; to: string }>> {
  const out = new Map<string, { from: string; to: string }>();
  if (planIds.length === 0) return out;
  const rows = await db.transaction((tx) => tx.execute(sql`
    SELECT id, period_from::text AS period_from, period_to::text AS period_to
      FROM plan.audit_plans
     WHERE tenant_id = ${tenantId} AND id IN (${sql.join(planIds.map((i) => sql`${i}::uuid`), sql`, `)})
  `));
  const list = (rows as unknown as { rows?: Array<{ id: string; period_from: string; period_to: string }> }).rows
    ?? (rows as unknown as Array<{ id: string; period_from: string; period_to: string }>);
  for (const r of list ?? []) out.set(r.id, { from: r.period_from, to: r.period_to });
  return out;
}

export async function lookupParaNumbers(tenantId: string, observationIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (observationIds.length === 0) return out;
  const rows = await db.transaction((tx) => tx.execute(sql`
    SELECT DISTINCT ON (observation_id) observation_id, para_no
      FROM para.audit_paras
     WHERE tenant_id = ${tenantId} AND observation_id IN (${sql.join(observationIds.map((i) => sql`${i}::uuid`), sql`, `)})
     ORDER BY observation_id, created_at DESC
  `));
  const list = (rows as unknown as { rows?: Array<{ observation_id: string; para_no: string }> }).rows
    ?? (rows as unknown as Array<{ observation_id: string; para_no: string }>);
  for (const r of list ?? []) out.set(r.observation_id, r.para_no);
  return out;
}
