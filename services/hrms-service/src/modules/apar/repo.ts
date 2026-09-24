import { eq, and, asc, desc, sql, inArray } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { hrmsAppraisals, type AppraisalRow, type AppraisalInsert } from "../appraisals/schema.js";
import { hrmsEmployees } from "../employee/schema.js";
import {
  hrmsAparScores, hrmsAparStageHistory,
  type AparScoreRow, type AparScoreInsert, type AparStageHistoryInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * List appraisals for a tenant, optionally restricted to a set of employeeId
 * values. `hrms_appraisals.employeeId` is an `hrms_employees.id` -- the row
 * HR selected via the employee picker when creating the APAR (apps/web's
 * apar/new/page.tsx posts `emp.id`, and apar/f3-consumer.ts's
 * apar_routes__0 stores it verbatim) -- it is NOT the acting user's actor
 * id. Callers must resolve an actor to their own hrms_employees.id (via
 * employee/actor-link.ts's resolveEmployeeForActor, keyed on
 * hrms_employees.userRef) before building the scoping set below; see
 * apar/routes.ts's resolveAparReadScope for the read-side resolution and
 * stageOwner/assertStageOwner for the write-side equivalent.
 *
 *  - allowedEmployeeIds === null   unrestricted (HR/super_admin) -- "HR sees all".
 *  - allowedEmployeeIds === []     caller can read nothing (fail-closed scope
 *                                  from apar/routes.ts's resolveAparReadScope,
 *                                  e.g. a manager or employee with no
 *                                  resolvable hrms_employees link).
 *                                  Short-circuits before querying.
 *  - allowedEmployeeIds === [...]  restricted to appraisals whose employeeId
 *                                  is in this set of hrms_employees.id
 *                                  values (caller's own resolved employee id
 *                                  plus, for a manager, direct reports'
 *                                  employee ids).
 */
export async function listAppraisals(
  tenantId: string,
  allowedEmployeeIds: string[] | null,
  limit = 100,
): Promise<AppraisalRow[]> {
  if (allowedEmployeeIds !== null && allowedEmployeeIds.length === 0) return [];
  const conditions = [eq(hrmsAppraisals.tenantId, tenantId)];
  if (allowedEmployeeIds !== null) {
    conditions.push(inArray(hrmsAppraisals.employeeId, allowedEmployeeIds));
  }
  return scopedRead((tx) => tx.select().from(hrmsAppraisals)
    .where(and(...conditions))
    .orderBy(desc(hrmsAppraisals.updatedAt))
    .limit(limit));
}

export async function findAppraisal(id: string, tenantId: string): Promise<AppraisalRow | null> {
  return scopedRead((tx) => findAppraisalTx(tx, id, tenantId));
}
export async function findAppraisalTx(tx: Writer, id: string, tenantId: string): Promise<AppraisalRow | null> {
  const rows = await tx.select().from(hrmsAppraisals)
    .where(and(eq(hrmsAppraisals.id, id), eq(hrmsAppraisals.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

/**
 * Update an appraisal, ALWAYS incrementing the optimistic-lock `version` column
 * (L4). When `expectedVersion` is supplied the update is GUARDED: the row is
 * only modified if its current version still matches, and a stale write raises
 * a 409 VERSION_CONFLICT instead of silently clobbering a concurrent change.
 */
export async function updateAppraisal(
  tx: Writer,
  id: string,
  patch: Partial<AppraisalInsert>,
  expectedVersion?: number,
): Promise<void> {
  const where =
    expectedVersion !== undefined
      ? and(eq(hrmsAppraisals.id, id), eq(hrmsAppraisals.version, expectedVersion))
      : eq(hrmsAppraisals.id, id);
  const res = await tx
    .update(hrmsAppraisals)
    .set({ ...patch, version: sql`${hrmsAppraisals.version} + 1`, updatedAt: new Date() })
    .where(where);
  if (expectedVersion !== undefined && ((res as { rowCount?: number; count?: number }).rowCount ?? (res as { count?: number }).count ?? 0) === 0) {
    throw new HttpError(409, "VERSION_CONFLICT",
      "appraisal was modified by another request; reload and retry");
  }
}

export async function upsertScore(tx: Writer, row: AparScoreInsert): Promise<void> {
  await tx.insert(hrmsAparScores).values(row).onConflictDoUpdate({
    target: [hrmsAparScores.appraisalId, hrmsAparScores.attribute],
    set: { weight: row.weight ?? "1", score: row.score, remarks: row.remarks ?? null, scoredBy: row.scoredBy, updatedAt: new Date() },
  });
}

export async function listScores(tenantId: string, appraisalId: string, limit = 500): Promise<AparScoreRow[]> {
  return scopedRead((tx) => listScoresTx(tx, tenantId, appraisalId, limit));
}
export async function listScoresTx(tx: Writer, tenantId: string, appraisalId: string, limit = 500): Promise<AparScoreRow[]> {
  return tx.select().from(hrmsAparScores)
    .where(and(eq(hrmsAparScores.tenantId, tenantId), eq(hrmsAparScores.appraisalId, appraisalId)))
    .orderBy(asc(hrmsAparScores.attribute))
    .limit(limit);
}

export async function appendHistory(tx: Writer, row: AparStageHistoryInsert): Promise<void> {
  await tx.insert(hrmsAparStageHistory).values(row);
}

export async function listHistory(tenantId: string, appraisalId: string, limit = 500) {
  return scopedRead((tx) => tx.select().from(hrmsAparStageHistory)
    .where(and(eq(hrmsAparStageHistory.tenantId, tenantId), eq(hrmsAparStageHistory.appraisalId, appraisalId)))
    .orderBy(asc(hrmsAparStageHistory.createdAt))
    .limit(limit));
}

/**
 * Direct reports of `managerEmployeeId` (an hrms_employees.id), returned as
 * their OWN hrms_employees.id values -- i.e. the same identity space as
 * hrms_appraisals.employeeId -- so callers can filter/compare appraisals
 * directly without a per-row lookup. Used by apar/routes.ts's
 * resolveAparReadScope for the "manager sees own reports" read scope,
 * mirroring the hrms_employees.managerId relationship employee/routes.ts's
 * resolveManagerScope uses for the same purpose.
 *
 * Returns `hrmsEmployees.id`, NOT `userRef`: a direct report's APAR rows
 * are keyed by their employee id regardless of whether that report's own
 * actor account has been linked yet (userRef populated) -- their manager
 * can see the appraisal either way, so unlike an actor-facing lookup there
 * is nothing to drop here. (Contrast resolveEmployeeForActor, which
 * resolves the other direction -- actor id -> own employee row -- and IS
 * userRef-gated because it has no employee id to fall back to.)
 */
export async function listDirectReportEmployeeIds(tenantId: string, managerEmployeeId: string): Promise<string[]> {
  const rows = await scopedRead((tx) => tx.select({ id: hrmsEmployees.id })
    .from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.tenantId, tenantId), eq(hrmsEmployees.managerId, managerEmployeeId))));
  return rows.map((r) => r.id);
}
