import { and, eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  riskControls, riskControlTests, riskIncidents, riskMitigationPlans, riskAcceptances, riskReviews,
  type ControlRow, type ControlInsert, type IncidentRow, type MitigationRow,
  type AcceptanceRow, type AcceptanceInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── controls ────────────────────────────────────────────────────────────────
export async function insertControl(tx: Writer, row: ControlInsert): Promise<void> {
  await tx.insert(riskControls).values(row);
}
export async function findControlByIdTx(tx: Writer, id: string, tenantId: string): Promise<ControlRow | null> {
  const rows = await (tx as typeof db).select().from(riskControls)
    .where(and(eq(riskControls.id, id), eq(riskControls.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}
export async function updateControlVersioned(tx: Writer, id: string, tenantId: string, expectedVersion: number, patch: Partial<ControlInsert>): Promise<number> {
  const res = await (tx as typeof db).update(riskControls)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(riskControls.id, id), eq(riskControls.tenantId, tenantId), eq(riskControls.version, expectedVersion)))
    .returning({ id: riskControls.id });
  return res.length;
}
export async function listControls(tenantId: string, riskId: string): Promise<ControlRow[]> {
  return db.transaction((tx) => tx.select().from(riskControls)
    .where(and(eq(riskControls.tenantId, tenantId), eq(riskControls.riskId, riskId)))
    .orderBy(desc(riskControls.createdAt)));
}
export async function insertControlTest(tx: Writer, row: typeof riskControlTests.$inferInsert): Promise<void> {
  await tx.insert(riskControlTests).values(row);
}

// ── incidents ─────────────────────────────────────────────────────────────
export async function insertIncident(tx: Writer, row: typeof riskIncidents.$inferInsert): Promise<void> {
  await tx.insert(riskIncidents).values(row);
}
export async function listIncidents(tenantId: string, limit: number): Promise<IncidentRow[]> {
  return db.transaction((tx) => tx.select().from(riskIncidents)
    .where(eq(riskIncidents.tenantId, tenantId))
    .orderBy(desc(riskIncidents.occurredAt)).limit(limit));
}

// ── mitigation plans ─────────────────────────────────────────────────────
export async function insertMitigation(tx: Writer, row: typeof riskMitigationPlans.$inferInsert): Promise<void> {
  await tx.insert(riskMitigationPlans).values(row);
}
export async function listMitigations(tenantId: string, riskId: string): Promise<MitigationRow[]> {
  return db.transaction((tx) => tx.select().from(riskMitigationPlans)
    .where(and(eq(riskMitigationPlans.tenantId, tenantId), eq(riskMitigationPlans.riskId, riskId)))
    .orderBy(desc(riskMitigationPlans.createdAt)));
}

// ── acceptances (maker-checker) ─────────────────────────────────────────────
export async function insertAcceptance(tx: Writer, row: AcceptanceInsert): Promise<void> {
  await tx.insert(riskAcceptances).values(row);
}
export async function findAcceptanceByIdTx(tx: Writer, id: string, tenantId: string): Promise<AcceptanceRow | null> {
  const rows = await (tx as typeof db).select().from(riskAcceptances)
    .where(and(eq(riskAcceptances.id, id), eq(riskAcceptances.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}
export async function updateAcceptanceVersioned(tx: Writer, id: string, tenantId: string, expectedVersion: number, patch: Partial<AcceptanceInsert>): Promise<number> {
  const res = await (tx as typeof db).update(riskAcceptances)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(riskAcceptances.id, id), eq(riskAcceptances.tenantId, tenantId), eq(riskAcceptances.version, expectedVersion)))
    .returning({ id: riskAcceptances.id });
  return res.length;
}
export async function listAcceptances(tenantId: string, riskId: string): Promise<AcceptanceRow[]> {
  return db.transaction((tx) => tx.select().from(riskAcceptances)
    .where(and(eq(riskAcceptances.tenantId, tenantId), eq(riskAcceptances.riskId, riskId)))
    .orderBy(desc(riskAcceptances.createdAt)));
}

// ── reviews ─────────────────────────────────────────────────────────────────
export async function insertReview(tx: Writer, row: typeof riskReviews.$inferInsert): Promise<void> {
  await tx.insert(riskReviews).values(row);
}
export async function listReviews(tenantId: string, riskId: string): Promise<typeof riskReviews.$inferSelect[]> {
  return db.transaction((tx) => tx.select().from(riskReviews)
    .where(and(eq(riskReviews.tenantId, tenantId), eq(riskReviews.riskId, riskId)))
    .orderBy(desc(riskReviews.reviewedAt)));
}
