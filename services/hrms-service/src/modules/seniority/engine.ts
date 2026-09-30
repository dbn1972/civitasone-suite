/**
 * Seniority list ranking engine — the pure computation shared by:
 *  - routes.ts:   GET /v1/hrms/seniority, GET /v1/hrms/dpc/eligibility (live, unpersisted)
 *  - consumer.ts: hrms.seniority.generate (persists a point-in-time snapshot)
 *
 * Order: date_of_joining ASC (earlier = senior), tie-break date_of_birth ASC
 * (older = senior), then merit (overall APAR grade) DESC as final tie-break.
 */
import { eq, and, inArray } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import { hrmsDepartments, hrmsDesignations } from "../employee/schema.js";
import { hrmsAppraisals } from "../appraisals/schema.js";

export function yearsBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO + "T00:00:00Z").getTime();
  const to = new Date(toISO + "T00:00:00Z").getTime();
  return (to - from) / (365.25 * 24 * 3600 * 1000);
}

export interface Ranked {
  rank: number;
  employeeId: string;
  employeeNo: string;
  fullName: string;
  designationId: string;
  departmentId: string;
  /** GAP-HR-DPC-01: resolved display name, "—" when the id has none on record. */
  department: string;
  /** GAP-HR-DPC-01: resolved display name, "—" when the id has none on record. */
  designation: string;
  /** GAP-HR-DPC-01: hrms_designations.pay_grade, "—" when unset. */
  grade: string;
  dateOfJoining: string;
  dateOfBirth: string | null;
  meritGrade: number | null;
  qualifyingYears: number;
}

function uniqueDefined(ids: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/**
 * Tx-scoped core: takes an already-open transaction so callers that need the
 * ranking computed as part of a larger write (e.g. the seniority.generate
 * consumer, which must persist the result in the same transaction) don't
 * have to nest a second `db.transaction()` inside their own.
 *
 * GAP-HR-DPC-01: department/designation/pay-grade are resolved here with
 * plain `tx.select()` calls against the SAME already-open `tx` — exactly
 * how this function already reads hrmsEmployees/hrmsAppraisals above,
 * not via a `scopedRead`-wrapping shared helper (batchDepartments/
 * batchDesignations in shared/batch-resolve.ts). Those helpers each open
 * their OWN `db.transaction()` internally; calling one of them from inside
 * this already-open `tx` would be the same nested-transaction
 * pool-exhaustion hazard `stageOverride()`'s doc comment in
 * apar/f3-consumer.ts warns about for an analogous case. Department/
 * designation names are looked up directly against this module's own `tx`
 * instead, matching the file's existing convention for hrmsEmployees /
 * hrmsAppraisals.
 */
export async function computeSeniority(
  tx: ScopedTx,
  tenantId: string,
  filter: { departmentId?: string; designationId?: string },
  asOf: string,
): Promise<Ranked[]> {
  const rows = await tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.tenantId, tenantId));

  // latest overall APAR grade per employee = merit signal
  const appraisals = await tx.select().from(hrmsAppraisals).where(eq(hrmsAppraisals.tenantId, tenantId));
  const meritByEmp = new Map<string, number>();
  for (const a of appraisals) {
    if (a.overallGrade == null) continue;
    const g = Number(a.overallGrade);
    const prev = meritByEmp.get(a.employeeId);
    if (prev === undefined || g > prev) meritByEmp.set(a.employeeId, g);
  }

  const filtered = rows.filter((e) => {
    if (filter.departmentId && e.departmentId !== filter.departmentId) return false;
    if (filter.designationId && e.designationId !== filter.designationId) return false;
    return e.status !== "separated";
  });

  // GAP-HR-DPC-01: batch-resolve department/designation names + pay grade
  // for exactly the ids this filtered page of employees actually uses.
  const deptIds = uniqueDefined(filtered.map((e) => e.departmentId));
  const desigIds = uniqueDefined(filtered.map((e) => e.designationId));
  const [deptRows, desigRows] = await Promise.all([
    deptIds.length > 0
      ? tx.select({ id: hrmsDepartments.id, name: hrmsDepartments.name })
          .from(hrmsDepartments)
          .where(and(eq(hrmsDepartments.tenantId, tenantId), inArray(hrmsDepartments.id, deptIds)))
      : Promise.resolve([]),
    desigIds.length > 0
      ? tx.select({ id: hrmsDesignations.id, name: hrmsDesignations.name, payGrade: hrmsDesignations.payGrade })
          .from(hrmsDesignations)
          .where(and(eq(hrmsDesignations.tenantId, tenantId), inArray(hrmsDesignations.id, desigIds)))
      : Promise.resolve([]),
  ]);
  const departmentNameById = new Map(deptRows.map((d) => [d.id, d.name]));
  const designationById = new Map(desigRows.map((d) => [d.id, { name: d.name, payGrade: d.payGrade }]));

  filtered.sort((a, b) => {
    // 1. date of joining ASC
    if (a.dateOfJoining !== b.dateOfJoining) return a.dateOfJoining < b.dateOfJoining ? -1 : 1;
    // 2. date of birth ASC (older first)
    const adob = a.dateOfBirth ?? "9999-12-31";
    const bdob = b.dateOfBirth ?? "9999-12-31";
    if (adob !== bdob) return adob < bdob ? -1 : 1;
    // 3. merit grade DESC
    const am = meritByEmp.get(a.id) ?? -1;
    const bm = meritByEmp.get(b.id) ?? -1;
    if (am !== bm) return bm - am;
    return a.employeeNo < b.employeeNo ? -1 : 1;
  });

  return filtered.map((e, i) => ({
    rank: i + 1,
    employeeId: e.id,
    employeeNo: e.employeeNo,
    fullName: e.fullName,
    designationId: e.designationId,
    departmentId: e.departmentId,
    department: departmentNameById.get(e.departmentId) ?? "—",
    designation: designationById.get(e.designationId)?.name ?? "—",
    grade: designationById.get(e.designationId)?.payGrade ?? "—",
    dateOfJoining: e.dateOfJoining,
    dateOfBirth: e.dateOfBirth ?? null,
    meritGrade: meritByEmp.get(e.id) ?? null,
    qualifyingYears: Math.round(yearsBetween(e.confirmationDate ?? e.dateOfJoining, asOf) * 100) / 100,
  }));
}

/** Read-only entry point for routes.ts: opens its own tenant-scoped read. */
export function buildSeniority(
  tenantId: string,
  filter: { departmentId?: string; designationId?: string },
  asOf: string,
): Promise<Ranked[]> {
  return scopedRead((tx) => computeSeniority(tx, tenantId, filter, asOf));
}
