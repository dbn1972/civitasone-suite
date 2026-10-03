import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsEmployees, hrmsDepartments } from "../employee/schema.js";
import {
  hrmsGrievances, hrmsGrievanceEvents, hrmsGrievanceSeq,
  type GrievanceRow, type GrievanceInsert, type GrievanceEventRow,
} from "./schema.js";
import { formatCaseNo } from "./domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export interface ListFilter {
  limit: number;
  offset: number;
  status?: string | undefined;
  /** Matches case number or employee name. */
  q?: string | undefined;
  /** Never return cases whose complainant is this employee (the acting user's own cases). */
  excludeEmployeeId?: string | null | undefined;
}

/** Coarse list row: NO subject/description (detail-only, DPDP). */
export interface GrievanceListRow {
  id: string;
  caseNo: string;
  employeeId: string;
  employee: string;
  department: string | null;
  category: string;
  filedDate: string;
  assignedTo: string | null;
  assignedToName: string | null;
  status: string;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listGrievances(
  tenantId: string, f: ListFilter,
): Promise<{ rows: GrievanceListRow[]; total: number }> {
  const assignee = alias(hrmsEmployees, "assignee");
  const conds = [eq(hrmsGrievances.tenantId, tenantId)];
  if (f.status) conds.push(eq(hrmsGrievances.status, f.status));
  if (f.excludeEmployeeId) conds.push(ne(hrmsGrievances.employeeId, f.excludeEmployeeId));
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    conds.push(or(ilike(hrmsGrievances.caseNo, like), ilike(hrmsEmployees.fullName, like))!);
  }
  return scopedRead(async (tx) => {
    const rows = await tx
      .select({
        id: hrmsGrievances.id, caseNo: hrmsGrievances.caseNo, employeeId: hrmsGrievances.employeeId,
        employee: hrmsEmployees.fullName, department: hrmsDepartments.name,
        category: hrmsGrievances.category, filedDate: hrmsGrievances.filedDate,
        assignedTo: hrmsGrievances.assignedTo, assignedToName: assignee.fullName,
        status: hrmsGrievances.status,
      })
      .from(hrmsGrievances)
      .leftJoin(hrmsEmployees, and(eq(hrmsEmployees.id, hrmsGrievances.employeeId), eq(hrmsEmployees.tenantId, tenantId)))
      .leftJoin(hrmsDepartments, and(eq(hrmsDepartments.id, hrmsEmployees.departmentId), eq(hrmsDepartments.tenantId, tenantId)))
      .leftJoin(assignee, and(eq(assignee.id, hrmsGrievances.assignedTo), eq(assignee.tenantId, tenantId)))
      .where(and(...conds))
      // Stable order: newest first, id breaks ties so paging never repeats/skips a row.
      .orderBy(desc(hrmsGrievances.createdAt), asc(hrmsGrievances.id))
      .limit(f.limit).offset(f.offset);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(hrmsGrievances)
      .leftJoin(hrmsEmployees, and(eq(hrmsEmployees.id, hrmsGrievances.employeeId), eq(hrmsEmployees.tenantId, tenantId)))
      .where(and(...conds));
    return {
      rows: rows.map((r) => ({ ...r, employee: r.employee ?? "—" })),
      total: n,
    };
  });
}

/** Per-status counts across the WHOLE register (not the current page). */
export async function statusCounts(tenantId: string, excludeEmployeeId?: string | null): Promise<Record<string, number>> {
  const rows = await scopedRead((tx) => tx
    .select({ status: hrmsGrievances.status, n: sql<number>`count(*)::int` })
    .from(hrmsGrievances).where(and(eq(hrmsGrievances.tenantId, tenantId), excludeEmployeeId ? ne(hrmsGrievances.employeeId, excludeEmployeeId) : undefined))
    .groupBy(hrmsGrievances.status));
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export async function findById(tenantId: string, id: string): Promise<GrievanceRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsGrievances)
    .where(and(eq(hrmsGrievances.tenantId, tenantId), eq(hrmsGrievances.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function findByIdTx(tx: Writer, tenantId: string, id: string): Promise<GrievanceRow | null> {
  const rows = await (tx as typeof db).select().from(hrmsGrievances)
    .where(and(eq(hrmsGrievances.tenantId, tenantId), eq(hrmsGrievances.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function listEvents(tenantId: string, grievanceId: string): Promise<GrievanceEventRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsGrievanceEvents)
    .where(and(eq(hrmsGrievanceEvents.tenantId, tenantId), eq(hrmsGrievanceEvents.grievanceId, grievanceId)))
    .orderBy(asc(hrmsGrievanceEvents.createdAt), asc(hrmsGrievanceEvents.id)));
}

/** Names for a set of employee ids (tenant-scoped). */
export async function employeeNames(tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const rows = await scopedRead((tx) => tx
    .select({ id: hrmsEmployees.id, name: hrmsEmployees.fullName }).from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.tenantId, tenantId), inArray(hrmsEmployees.id, uniq))));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Atomically take the next case number for (tenant, year). The upsert is a
 * single statement, so two concurrent registrations can never read the same
 * counter value; the (tenant, case_no) unique index is the backstop.
 */
export async function nextCaseNoTx(tx: Writer, tenantId: string, year: number): Promise<string> {
  const res = await tx.insert(hrmsGrievanceSeq)
    .values({ tenantId, year, nextVal: 1 })
    .onConflictDoUpdate({
      target: [hrmsGrievanceSeq.tenantId, hrmsGrievanceSeq.year],
      set: { nextVal: sql`${hrmsGrievanceSeq.nextVal} + 1` },
    })
    .returning({ nextVal: hrmsGrievanceSeq.nextVal });
  return formatCaseNo(year, res[0]?.nextVal ?? 1);
}

export async function insertTx(tx: Writer, row: GrievanceInsert): Promise<boolean> {
  const res = await tx.insert(hrmsGrievances).values(row).onConflictDoNothing().returning({ id: hrmsGrievances.id });
  return res.length > 0;
}

export async function insertEventTx(
  tx: Writer,
  ev: { tenantId: string; grievanceId: string; action: string; fromStatus: string | null; toStatus: string; actorId: string; assignedTo?: string | null; note?: string | null },
): Promise<void> {
  await tx.insert(hrmsGrievanceEvents).values({
    tenantId: ev.tenantId, grievanceId: ev.grievanceId, action: ev.action,
    fromStatus: ev.fromStatus, toStatus: ev.toStatus, actorId: ev.actorId,
    assignedTo: ev.assignedTo ?? null, note: ev.note ?? null,
  });
}

/**
 * Race-safe guarded transition: only flips the row when its CURRENT status is
 * one of `from` (a single conditional UPDATE ... RETURNING, so two concurrent
 * dispose/assign commands cannot both win). Returns the previous status, or
 * null when the guard rejected (already disposed / not found / other tenant).
 */
export async function transitionTx(
  tx: Writer, tenantId: string, id: string, actorId: string,
  opts: { from: readonly string[]; to: string; set?: Partial<GrievanceInsert> },
): Promise<{ row: GrievanceRow; fromStatus: string } | null> {
  const before = await findByIdTx(tx, tenantId, id);
  if (!before || !opts.from.includes(before.status)) return null;
  const rows = await tx.update(hrmsGrievances)
    .set({ ...opts.set, status: opts.to, updatedBy: actorId, updatedAt: new Date(), version: sql`${hrmsGrievances.version} + 1` })
    .where(and(
      eq(hrmsGrievances.tenantId, tenantId), eq(hrmsGrievances.id, id),
      inArray(hrmsGrievances.status, [...opts.from]),
    ))
    .returning();
  const row = rows[0];
  return row ? { row, fromStatus: before.status } : null;
}
