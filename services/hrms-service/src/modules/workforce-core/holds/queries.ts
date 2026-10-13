/**
 * Hold-registry eligibility read model (SmartTransfer OS, ST-M01-10).
 *
 * The getOrLoad-able read SmartTransfer's eligibility calls to learn whether an
 * employee is under an active hold before offering them in a transfer cycle.
 * Spec §4, §11; PROPOSED D-ST-16 (read the existing registry only).
 *
 * Every read runs under `scopedRead`, so PostgreSQL RLS on
 * `lifecycle.hrms_employee_holds` scopes it to the caller's tenant (a
 * NOBYPASSRLS service role with no app.tenant_id GUC sees zero rows). The
 * result is cached with `cache.getOrLoad` keyed by tenant + employee + as-of
 * date, so a cross-service caller reading through the gateway gets the standard
 * cache-aside behaviour (the same pattern employee/leave/attendance queries use).
 */
import { cache } from "../../../shared/infra.js";
import { scopedRead } from "../../../shared/db.js";
import * as repo from "./repo.js";

export interface EmployeeHoldsView {
  employeeId: string;
  asOf: string;
  /** True when any active hold would BLOCK a posting under current config. */
  hasBlockingHold: boolean;
  holds: Array<{
    id: string;
    holdType: string;
    status: string;
    reason: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    /** Whether this specific hold blocks a posting (vs merely being active). */
    blocks: boolean;
  }>;
}

/**
 * The active holds on an employee as of `asOf` (YYYY-MM-DD), with a top-level
 * `hasBlockingHold` eligibility can gate on directly. Cached per
 * tenant+employee+as-of.
 */
export async function getEmployeeHolds(
  tenantId: string,
  employeeId: string,
  asOf: string,
): Promise<EmployeeHoldsView> {
  const view = await cache.getOrLoad<EmployeeHoldsView>(
    cache.makeKey(tenantId, "employee-holds", `${employeeId}:${asOf}`),
    async () => {
      const rows = await scopedRead((tx) =>
        repo.listActiveHolds(tx, employeeId, asOf),
      );
      return {
        employeeId,
        asOf,
        hasBlockingHold: rows.some((r) => r.blocks),
        holds: rows.map((r) => ({
          id: r.id,
          holdType: r.holdType,
          status: r.status,
          reason: r.reason,
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo,
          blocks: r.blocks,
        })),
      };
    },
  );
  // The loader always returns a view (never null); getOrLoad's signature is
  // `T | null` only because it can cache a null loader result. Fall back to an
  // empty active-holds view so the return type is non-null and a cache miss
  // can never surface as a null to eligibility.
  return view ?? { employeeId, asOf, hasBlockingHold: false, holds: [] };
}

/** Today's date as YYYY-MM-DD (UTC), the default as-of for the read API. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
