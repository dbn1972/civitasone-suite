import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsApplications, hrmsScreeningEvents, type ScreeningEventRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
type ApplicationRow = typeof hrmsApplications.$inferSelect;

export async function findApplication(tenantId: string, id: string): Promise<ApplicationRow | null> {
  return scopedRead((tx) => findApplicationTx(tx, tenantId, id));
}

/** Tx-scoped variant of findApplication -- see .claude/skills/16-production-readiness-audit.md section 1. */
export async function findApplicationTx(tx: Writer, tenantId: string, id: string): Promise<ApplicationRow | null> {
  const rows = await (tx as typeof db).select().from(hrmsApplications)
    .where(and(eq(hrmsApplications.tenantId, tenantId), eq(hrmsApplications.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function listApplicationsForVacancy(tenantId: string, jobOpeningId: string, limit = 500): Promise<ApplicationRow[]> {
  return scopedRead((tx) => listApplicationsForVacancyTx(tx, tenantId, jobOpeningId, limit));
}

/** Tx-scoped variant of listApplicationsForVacancy -- see .claude/skills/16-production-readiness-audit.md section 1. */
export async function listApplicationsForVacancyTx(tx: Writer, tenantId: string, jobOpeningId: string, limit = 500): Promise<ApplicationRow[]> {
  return (tx as typeof db).select().from(hrmsApplications)
    .where(and(eq(hrmsApplications.tenantId, tenantId), eq(hrmsApplications.jobOpeningId, jobOpeningId)))
    .orderBy(desc(hrmsApplications.appliedAt)).limit(limit);
}

/** Applications for a vacancy filtered to a set of ids (for bulk shortlist). */
export async function findApplicationsByIds(tenantId: string, jobOpeningId: string, ids: string[]): Promise<ApplicationRow[]> {
  if (ids.length === 0) return [];
  return scopedRead((tx) => findApplicationsByIdsTx(tx, tenantId, jobOpeningId, ids));
}

/** Tx-scoped variant of findApplicationsByIds -- see .claude/skills/16-production-readiness-audit.md section 1. */
export async function findApplicationsByIdsTx(tx: Writer, tenantId: string, jobOpeningId: string, ids: string[]): Promise<ApplicationRow[]> {
  if (ids.length === 0) return [];
  return (tx as typeof db).select().from(hrmsApplications)
    .where(and(
      eq(hrmsApplications.tenantId, tenantId),
      eq(hrmsApplications.jobOpeningId, jobOpeningId),
      inArray(hrmsApplications.id, ids),
    ));
}

export async function setScreening(
  tx: Writer, tenantId: string, id: string,
  patch: Partial<typeof hrmsApplications.$inferInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsApplications)
    .set({ ...patch, version: sql`${hrmsApplications.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsApplications.tenantId, tenantId), eq(hrmsApplications.id, id), eq(hrmsApplications.version, expectedVersion)));
  // postgres-js reports affected rows as `.count` (drizzle's `.rowCount` is
  // undefined on this driver) — check both so the version guard actually fires.
  const changed = (res as { rowCount?: number; count?: number }).rowCount ?? (res as { count?: number }).count ?? 0;
  if (changed === 0) {
    throw new Error("VERSION_CONFLICT");
  }
}

/** Update screening decision without a version guard (bulk / idempotent auto-screen). */
export async function setScreeningById(
  tx: Writer, tenantId: string, id: string, patch: Partial<typeof hrmsApplications.$inferInsert>,
): Promise<void> {
  await tx.update(hrmsApplications)
    .set({ ...patch, version: sql`${hrmsApplications.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsApplications.tenantId, tenantId), eq(hrmsApplications.id, id)));
}

export async function insertEvent(
  tx: Writer,
  row: {
    tenantId: string; applicationId: string; jobOpeningId: string; action: string;
    decision?: string | null; reasonCode?: string | null; remarks?: string | null;
    isOverride?: boolean; actorId: string;
  },
): Promise<void> {
  await tx.insert(hrmsScreeningEvents).values({
    tenantId: row.tenantId, applicationId: row.applicationId, jobOpeningId: row.jobOpeningId,
    action: row.action, decision: row.decision ?? null, reasonCode: row.reasonCode ?? null,
    remarks: row.remarks ?? null, isOverride: row.isOverride ?? false, actorId: row.actorId,
  });
}

export async function listEvents(tenantId: string, applicationId: string): Promise<ScreeningEventRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsScreeningEvents)
    .where(and(eq(hrmsScreeningEvents.tenantId, tenantId), eq(hrmsScreeningEvents.applicationId, applicationId)))
    .orderBy(hrmsScreeningEvents.createdAt));
}
