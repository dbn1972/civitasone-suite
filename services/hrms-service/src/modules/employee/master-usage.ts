/**
 * Reference counting for the department / designation masters.
 *
 * Neither `hrms_departments` nor `hrms_designations` is the target of a
 * database foreign key (employee/schema.ts documents `departmentId` /
 * `designationId` as plain uuid columns), so deleting a master row never
 * fails at the database -- it silently orphans every record that still
 * points at it. These helpers are the application-level guard for that:
 * masters-routes.ts runs them synchronously before it publishes a delete,
 * and f3-consumer.ts runs them again inside the consuming transaction so a
 * reference created between the route's 202 and the consumer actually
 * running cannot slip through (GAP-HR-DEPARTMENTS-02,
 * GAP-HR-DESIGNATIONS-02).
 *
 * All queries are tenant-scoped, take the caller's transaction (so they are
 * RLS-scoped exactly like the write they guard), and use the same builder
 * shape as the rest of this module.
 */
import { and, count, eq, inArray, notInArray } from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import type { ScopedTx } from "../../shared/db.js";
import { hrmsDepartments, hrmsEmployees } from "./schema.js";
import { EXITED_STATUSES } from "./status.js";
import { hrmsSeniorityLists, hrmsSeniorityListEntries } from "../seniority/schema.js";
import { wcPost } from "../workforce-core/schema.js";
import { manpowerPlans, manpowerRequisitions } from "../manpower-planning/schema.js";
import { hrmsJobOpenings } from "../recruitment/schema.js";
import { hrmsRequisitions } from "../recruitment/requisition-schema.js";
import { hrmsAssessmentBlueprints } from "../recruitment/blueprint-schema.js";
import { hrmsSanctionedPosts } from "../reservation/schema.js";
import { hrmsPromotions, hrmsTransfers } from "../lifecycle/schema.js";

type Tx = Pick<ScopedTx, "select">;

// ── Departments ─────────────────────────────────────────────────────────────

/**
 * Employees per department, excluding EXITED_STATUSES (terminated /
 * separated / retired) -- an employee who has already left is deliberately
 * not a reason to block a department delete or re-parent (GAP-HR-DEPARTMENTS-01).
 *
 * Plain row select + in-process tally rather than a SQL GROUP BY: the
 * tenant's whole workforce is a small, bounded row set and this keeps the
 * query shape identical to every other `scopedRead` call in masters-routes.ts.
 */
export async function countActiveEmployeesByDeptTx(
  tx: Tx,
  tenantId: string,
  deptIds: string[],
): Promise<Map<string, number>> {
  if (deptIds.length === 0) return new Map();
  const rows = await tx
    .select({ departmentId: hrmsEmployees.departmentId })
    .from(hrmsEmployees)
    .where(and(
      eq(hrmsEmployees.tenantId, tenantId),
      inArray(hrmsEmployees.departmentId, deptIds),
      notInArray(hrmsEmployees.status, [...EXITED_STATUSES]),
    ));
  const counts = new Map<string, number>();
  for (const r of rows) {
    counts.set(r.departmentId, (counts.get(r.departmentId) ?? 0) + 1);
  }
  return counts;
}

/** Direct child departments of `deptId` (tenant-scoped). */
export async function countChildDepartmentsTx(tx: Tx, tenantId: string, deptId: string): Promise<number> {
  const rows = await tx
    .select({ childCount: count() })
    .from(hrmsDepartments)
    .where(and(eq(hrmsDepartments.tenantId, tenantId), eq(hrmsDepartments.parentId, deptId)));
  // A bare COUNT(*) aggregate always returns exactly one row in practice, but
  // the array type alone doesn't guarantee that to the compiler -- default to
  // 0 rather than assume/destructure.
  return Number(rows[0]?.childCount ?? 0);
}

export interface DepartmentUsage {
  childCount: number;
  employeeCount: number;
}

/** What still points at `deptId`: sub-departments and active employees. */
export async function departmentUsageTx(tx: Tx, tenantId: string, deptId: string): Promise<DepartmentUsage> {
  const childCount = await countChildDepartmentsTx(tx, tenantId, deptId);
  const employeeCounts = await countActiveEmployeesByDeptTx(tx, tenantId, [deptId]);
  return { childCount, employeeCount: employeeCounts.get(deptId) ?? 0 };
}

// ── Designations ────────────────────────────────────────────────────────────

/**
 * Every in-service table that stores a hrms_designations.id. `key` is the
 * stable machine name returned to API callers in the 409 breakdown;
 * `columns` lists each designation-id column of that table (promotions and
 * transfers carry two). `employees` counts ALL employees holding the
 * designation, including exited ones: an ex-employee's service record would
 * otherwise render a blank designation.
 */
interface DesignationReferrer {
  key: string;
  table: AnyPgTable;
  tenantId: AnyPgColumn;
  columns: AnyPgColumn[];
}

export const DESIGNATION_REFERRERS: readonly DesignationReferrer[] = [
  { key: "employees", table: hrmsEmployees, tenantId: hrmsEmployees.tenantId, columns: [hrmsEmployees.designationId] },
  { key: "seniorityLists", table: hrmsSeniorityLists, tenantId: hrmsSeniorityLists.tenantId, columns: [hrmsSeniorityLists.designationId] },
  { key: "seniorityEntries", table: hrmsSeniorityListEntries, tenantId: hrmsSeniorityListEntries.tenantId, columns: [hrmsSeniorityListEntries.designationId] },
  { key: "workforcePosts", table: wcPost, tenantId: wcPost.tenantId, columns: [wcPost.designationId] },
  { key: "manpowerPlans", table: manpowerPlans, tenantId: manpowerPlans.tenantId, columns: [manpowerPlans.designationId] },
  { key: "manpowerRequisitions", table: manpowerRequisitions, tenantId: manpowerRequisitions.tenantId, columns: [manpowerRequisitions.designationId] },
  { key: "jobOpenings", table: hrmsJobOpenings, tenantId: hrmsJobOpenings.tenantId, columns: [hrmsJobOpenings.designationId] },
  { key: "recruitmentRequisitions", table: hrmsRequisitions, tenantId: hrmsRequisitions.tenantId, columns: [hrmsRequisitions.designationId] },
  { key: "assessmentBlueprints", table: hrmsAssessmentBlueprints, tenantId: hrmsAssessmentBlueprints.tenantId, columns: [hrmsAssessmentBlueprints.designationId] },
  { key: "sanctionedPosts", table: hrmsSanctionedPosts, tenantId: hrmsSanctionedPosts.tenantId, columns: [hrmsSanctionedPosts.designationId] },
  { key: "promotions", table: hrmsPromotions, tenantId: hrmsPromotions.tenantId, columns: [hrmsPromotions.fromDesigId, hrmsPromotions.toDesigId] },
  { key: "transfers", table: hrmsTransfers, tenantId: hrmsTransfers.tenantId, columns: [hrmsTransfers.fromDesigId, hrmsTransfers.toDesigId] },
];

export interface DesignationUsage {
  /** Rows across every referrer that still carry this designation id. */
  total: number;
  /** Employees holding it (also included in `total`). */
  employees: number;
  /** Per-referrer row counts, only for referrers with at least one row. */
  references: Record<string, number>;
}

/**
 * Reference counts for the given designation ids, across every table in
 * DESIGNATION_REFERRERS. The returned map has an entry for every requested
 * id (zeroed when nothing references it). Tenant-scoped on every table.
 */
export async function designationUsageTx(
  tx: Tx,
  tenantId: string,
  designationIds: string[],
): Promise<Map<string, DesignationUsage>> {
  const out = new Map<string, DesignationUsage>();
  for (const id of designationIds) out.set(id, { total: 0, employees: 0, references: {} });
  if (designationIds.length === 0) return out;

  for (const ref of DESIGNATION_REFERRERS) {
    for (const col of ref.columns) {
      const rows = await tx
        .select({ designationId: col, n: count() })
        .from(ref.table)
        .where(and(eq(ref.tenantId, tenantId), inArray(col, designationIds)))
        .groupBy(col);
      for (const r of rows) {
        const id = r.designationId as string | null;
        if (!id) continue;
        const usage = out.get(id);
        if (!usage) continue;
        const n = Number(r.n ?? 0);
        if (n <= 0) continue;
        usage.total += n;
        usage.references[ref.key] = (usage.references[ref.key] ?? 0) + n;
        if (ref.key === "employees") usage.employees += n;
      }
    }
  }
  return out;
}

/** Convenience wrapper for the single-id delete guard. */
export async function designationUsageForOneTx(tx: Tx, tenantId: string, designationId: string): Promise<DesignationUsage> {
  const usage = await designationUsageTx(tx, tenantId, [designationId]);
  return usage.get(designationId) ?? { total: 0, employees: 0, references: {} };
}
