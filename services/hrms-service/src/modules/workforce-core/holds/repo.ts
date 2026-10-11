/**
 * Hold-registry reads (SmartTransfer OS, ST-M01-10).
 *
 * Reads the EXISTING `lifecycle.hrms_employee_holds` table (migration 0103),
 * modelled in lifecycle/schema.ts as `hrmsEmployeeHolds`. This row only READS
 * that table — it never writes it, adds no column and defines no new hold type
 * (PROPOSED D-ST-16). Two readers:
 *
 *   • `findActiveBlockingHold` — used INSIDE the applyPosting transaction to
 *     refuse a posting when an active, blocking hold covers the effective date.
 *   • `listActiveHolds`        — the eligibility read model behind the staff-only
 *     read API that SmartTransfer consumes (getOrLoad-able).
 *
 * Both take the caller's open transaction (`Writer`) OR run under `scopedRead`,
 * so PostgreSQL RLS on `lifecycle.hrms_employee_holds` (FORCE RLS, tenant_id =
 * current_setting('app.tenant_id')) scopes every read to the caller's tenant —
 * a cross-tenant read returns zero rows, never a leak (house rule 2/9, D-ST-04).
 */
import { and, eq, inArray, isNull, lte, gte, or, sql } from "drizzle-orm";
import type { db } from "../../../shared/db.js";
import { hrmsEmployeeHolds } from "../../lifecycle/schema.js";
import {
  ACTIVE_HOLD_STATUSES,
  blockingHoldTypes,
  type HoldType,
} from "./config.js";

export type Writer = Pick<typeof db, "select">;

/** A single active hold, as surfaced to eligibility / the apply guard. */
export interface ActiveHold {
  id: string;
  employeeId: string;
  holdType: string;
  status: string;
  reason: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * The first ACTIVE hold on an employee that BLOCKS a posting on `asOfDate`.
 *
 * "Active" = status in (approved, active). "Blocks" = hold_type is in the
 * configured blocking set (conservative default: every hold type). "Covers the
 * date" = effective_from <= asOfDate AND (effective_to IS NULL OR
 * effective_to >= asOfDate) — an inclusive window on dates.
 *
 * Returns `undefined` when no such hold exists (the posting may proceed). The
 * read is RLS-scoped to the caller's tenant by the open transaction.
 */
export async function findActiveBlockingHold(
  tx: Writer,
  employeeId: string,
  asOfDate: string,
  blocking: ReadonlySet<HoldType> = blockingHoldTypes(),
): Promise<ActiveHold | undefined> {
  const rows = await (tx as typeof db)
    .select({
      id: hrmsEmployeeHolds.id,
      employeeId: hrmsEmployeeHolds.employeeId,
      holdType: hrmsEmployeeHolds.holdType,
      status: hrmsEmployeeHolds.status,
      reason: hrmsEmployeeHolds.reason,
      effectiveFrom: hrmsEmployeeHolds.effectiveFrom,
      effectiveTo: hrmsEmployeeHolds.effectiveTo,
    })
    .from(hrmsEmployeeHolds)
    .where(
      and(
        eq(hrmsEmployeeHolds.employeeId, employeeId),
        inArray(hrmsEmployeeHolds.status, [...ACTIVE_HOLD_STATUSES]),
        inArray(hrmsEmployeeHolds.holdType, [...blocking]),
        lte(hrmsEmployeeHolds.effectiveFrom, asOfDate),
        or(
          isNull(hrmsEmployeeHolds.effectiveTo),
          gte(hrmsEmployeeHolds.effectiveTo, asOfDate),
        ),
      ),
    )
    // Deterministic pick: oldest hold first.
    .orderBy(sql`${hrmsEmployeeHolds.effectiveFrom} ASC, ${hrmsEmployeeHolds.id} ASC`)
    .limit(1);
  return rows[0];
}

/**
 * All ACTIVE holds on an employee as of `asOfDate`, regardless of whether the
 * configured blocking set would stop a posting. Eligibility wants the full
 * active picture (so it can show WHY, and apply its own policy); the `blocks`
 * flag tells it which of them the apply path would refuse on.
 */
export async function listActiveHolds(
  tx: Writer,
  employeeId: string,
  asOfDate: string,
): Promise<Array<ActiveHold & { blocks: boolean }>> {
  const blocking = blockingHoldTypes();
  const rows = await (tx as typeof db)
    .select({
      id: hrmsEmployeeHolds.id,
      employeeId: hrmsEmployeeHolds.employeeId,
      holdType: hrmsEmployeeHolds.holdType,
      status: hrmsEmployeeHolds.status,
      reason: hrmsEmployeeHolds.reason,
      effectiveFrom: hrmsEmployeeHolds.effectiveFrom,
      effectiveTo: hrmsEmployeeHolds.effectiveTo,
    })
    .from(hrmsEmployeeHolds)
    .where(
      and(
        eq(hrmsEmployeeHolds.employeeId, employeeId),
        inArray(hrmsEmployeeHolds.status, [...ACTIVE_HOLD_STATUSES]),
        lte(hrmsEmployeeHolds.effectiveFrom, asOfDate),
        or(
          isNull(hrmsEmployeeHolds.effectiveTo),
          gte(hrmsEmployeeHolds.effectiveTo, asOfDate),
        ),
      ),
    )
    .orderBy(sql`${hrmsEmployeeHolds.effectiveFrom} ASC, ${hrmsEmployeeHolds.id} ASC`);
  return rows.map((r) => ({
    ...r,
    blocks: blocking.has(r.holdType as HoldType),
  }));
}
