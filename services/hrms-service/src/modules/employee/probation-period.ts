/**
 * Probation PERIOD resolution (GAP-HR-CONFIRMATION-05).
 *
 * An employee's default probation end used to be a hard-coded "joining date + 2
 * years" for everyone, so a service-rule variant (a 12-month probation, a 6-month
 * contractual one) could not be represented even though the employee-type master
 * already carries `default_probation_months`. This resolves the period, in
 * months, from that existing master -- additive and reversible:
 *
 *   1. the tenant's own employee-type row (matched by the employee's
 *      `employeeType` code), when it configures a positive number of months;
 *   2. else the canonical engagement-catalogue row for that type's category
 *      (the type's own `category`, or the code itself when it IS a category);
 *   3. else LEGACY_PROBATION_MONTHS (24 -- the previous fixed rule), so an
 *      employee whose type configures nothing (0 / unknown / legacy
 *      "permanent") behaves exactly as before.
 *
 * Per-employee extensions (hrms_probation_extensions) still override the result:
 * the latest recorded extension is the current probation end. The pure builders
 * below take already-loaded rows so they are unit-testable without a database.
 */
import { addMonthsToDateOnly } from "../../shared/ist.js";
import { loadTypeRows } from "./engagement-policy.js";

/** The fixed probation length (months) used before the type master was read; the fallback when a type sets none. */
export const LEGACY_PROBATION_MONTHS = 24;

type Row = Record<string, unknown>;

function positiveMonths(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/** Pure: employeeType code -> probation length in months. */
export function buildProbationMonthsResolver(tenantTypes: readonly Row[], canonical: readonly Row[]): (employeeType: string) => number {
  const byCode = new Map(tenantTypes.map((t) => [String(t.code), t]));
  const byCategory = new Map(canonical.map((c) => [String(c.category), c]));
  return (employeeType: string): number => {
    const tenantRow = byCode.get(employeeType);
    const own = positiveMonths(tenantRow?.defaultProbationMonths);
    if (own !== null) return own;
    const category = tenantRow ? String(tenantRow.category ?? "other") : employeeType;
    return positiveMonths(byCategory.get(category)?.defaultProbationMonths) ?? LEGACY_PROBATION_MONTHS;
  };
}

/** Loads the tenant's type master + canonical catalogue and returns the resolver. */
export async function loadProbationMonthsResolver(tenantId: string): Promise<(employeeType: string) => number> {
  const { tenantTypes, canonical } = await loadTypeRows(tenantId);
  return buildProbationMonthsResolver(tenantTypes, canonical);
}

/**
 * Pure: the default probation end for a joining date and period (before any
 * extension). Null when the joining date is missing/unparseable.
 */
export function defaultProbationEnd(dateOfJoining: string | null | undefined, months: number): string | null {
  if (!dateOfJoining) return null;
  return addMonthsToDateOnly(dateOfJoining, months);
}
