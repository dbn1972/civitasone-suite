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

export interface ListAppraisalsOptions {
  /** Exact backend status match (e.g. "reporting_officer"). */
  status?: string;
  /** Exact appraisalPeriod match (e.g. "2025-26"). */
  period?: string;
  limit?: number;
  offset?: number;
}

export interface ListAppraisalsResult {
  rows: AppraisalRow[];
  /** Total rows matching tenant+scope+filters, ignoring limit/offset -- lets the caller tell "100 shown" from "100 of 100". */
  total: number;
}

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
 *
 * GAP-HR-APAR-06: `opts.status`/`opts.period` add optional exact-match
 * filters, and the result now also reports `total` (same tenant+scope+filter
 * conditions, ignoring limit/offset) so a caller showing "first N" rows can
 * say how many rows exist in total instead of silently capping at `limit`
 * with no indication more exist.
 */
export async function listAppraisals(
  tenantId: string,
  allowedEmployeeIds: string[] | null,
  opts: ListAppraisalsOptions = {},
): Promise<ListAppraisalsResult> {
  if (allowedEmployeeIds !== null && allowedEmployeeIds.length === 0) return { rows: [], total: 0 };
  const conditions = [eq(hrmsAppraisals.tenantId, tenantId)];
  if (allowedEmployeeIds !== null) {
    conditions.push(inArray(hrmsAppraisals.employeeId, allowedEmployeeIds));
  }
  if (opts.status) conditions.push(eq(hrmsAppraisals.status, opts.status));
  if (opts.period) conditions.push(eq(hrmsAppraisals.appraisalPeriod, opts.period));
  const where = and(...conditions);
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  return scopedRead(async (tx) => {
    const [rows, totalRows] = await Promise.all([
      tx.select().from(hrmsAppraisals).where(where).orderBy(desc(hrmsAppraisals.updatedAt)).limit(limit).offset(offset),
      tx.select({ count: sql<number>`count(*)::int` }).from(hrmsAppraisals).where(where),
    ]);
    return { rows, total: totalRows[0]?.count ?? 0 };
  });
}

export interface AparStatusGroupCounts {
  selfPending: number;
  inReview: number;
  awaitingClosure: number;
  finalised: number;
}

/**
 * GAP-HR-APAR-01 / GAP-HR-APAR-06: server-side status-group counts for the
 * list page's stat cards, scoped exactly like listAppraisals (tenant +
 * caller's read scope) but deliberately NOT limited by any status/period
 * filter the caller passed to listAppraisals -- these are meant to describe
 * the whole scoped population ("how many are where"), the same way the DPC
 * page's stat cards aren't affected by its own table's local filter box.
 * Grouped per apps/web's `@/lib/apar/stages` module: self_pending alone;
 * reporting/reviewing/accepting_authority as one "in review" bucket;
 * disclosed+representation as "awaiting closure"; finalised on its own.
 */
export async function countAparsByStatusGroup(
  tenantId: string,
  allowedEmployeeIds: string[] | null,
): Promise<AparStatusGroupCounts> {
  const empty: AparStatusGroupCounts = { selfPending: 0, inReview: 0, awaitingClosure: 0, finalised: 0 };
  if (allowedEmployeeIds !== null && allowedEmployeeIds.length === 0) return empty;
  const conditions = [eq(hrmsAppraisals.tenantId, tenantId)];
  if (allowedEmployeeIds !== null) {
    conditions.push(inArray(hrmsAppraisals.employeeId, allowedEmployeeIds));
  }
  const rows = await scopedRead((tx) => tx
    .select({ status: hrmsAppraisals.status, count: sql<number>`count(*)::int` })
    .from(hrmsAppraisals)
    .where(and(...conditions))
    .groupBy(hrmsAppraisals.status));
  const out: AparStatusGroupCounts = { ...empty };
  const IN_REVIEW = new Set(["reporting_officer", "reviewing_officer", "accepting_authority"]);
  const AWAITING_CLOSURE = new Set(["disclosed", "representation"]);
  for (const r of rows) {
    if (r.status === "self_pending") out.selfPending += r.count;
    else if (IN_REVIEW.has(r.status)) out.inReview += r.count;
    else if (AWAITING_CLOSURE.has(r.status)) out.awaitingClosure += r.count;
    else if (r.status === "finalised") out.finalised += r.count;
    // Legacy/unrecognised statuses (e.g. old "pending" rows) are counted in
    // `total` (listAppraisals) but deliberately not folded into any of these
    // four buckets -- see GAP-HR-APAR-01's fallback-to-stage-0 note for the
    // display-side equivalent.
  }
  return out;
}

export async function findAppraisal(id: string, tenantId: string): Promise<AppraisalRow | null> {
  return scopedRead((tx) => findAppraisalTx(tx, id, tenantId));
}

/**
 * GAP-HR-APAR-NEW-04: synchronous pre-check for the one-APAR-per-employee-
 * per-period rule (apar/routes.ts's create handler). App-level only, no DB
 * unique index -- see that route's comment for why a migration is
 * deliberately out of scope here.
 */
export async function findAppraisalByEmployeeAndPeriod(
  tenantId: string,
  employeeId: string,
  appraisalPeriod: string,
): Promise<AppraisalRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsAppraisals)
    .where(and(
      eq(hrmsAppraisals.tenantId, tenantId),
      eq(hrmsAppraisals.employeeId, employeeId),
      eq(hrmsAppraisals.appraisalPeriod, appraisalPeriod),
    )).limit(1));
  return rows[0] ?? null;
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
