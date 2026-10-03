/**
 * GAP-HR-WFH-01: WFH eligibility by pay level.
 *
 * Source of the level: hrms_designations.level of the employee's designation --
 * the 7th CPC pay-matrix level (1-18; 0 is the "unclassified" sentinel, see
 * apps/web/src/lib/payLevels.ts and GAP-HR-DESIGNATIONS-01). The threshold and
 * the on/off switch are per-tenant policy (policy-settings key wfh_eligibility,
 * default: Level 10 and above = Group A = not eligible, per the repo's payLevels.ts).
 */
import { and, eq } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { hrmsEmployees, hrmsDesignations } from "../employee/schema.js";
import type { WfhEligibility } from "../policy-settings/registry.js";

export type PayLevelResolution = { payLevel: number | null };

/** Level 0 / missing = unclassified: we do not know, so we do not guess. */
export function normalisePayLevel(level: number | null | undefined): number | null {
  return typeof level === "number" && Number.isInteger(level) && level >= 1 && level <= 18 ? level : null;
}

export function isGazettedForWfh(payLevel: number | null, policy: WfhEligibility): boolean {
  if (!policy.enforceGazettedExclusion || payLevel === null) return false;
  return payLevel > policy.maxPayLevel;
}

export async function resolveEmployeePayLevel(tenantId: string, employeeId: string): Promise<PayLevelResolution> {
  const rows = await scopedRead((tx) => tx.select({ level: hrmsDesignations.level })
    .from(hrmsEmployees)
    .innerJoin(hrmsDesignations, and(eq(hrmsDesignations.id, hrmsEmployees.designationId), eq(hrmsDesignations.tenantId, hrmsEmployees.tenantId)))
    .where(and(eq(hrmsEmployees.tenantId, tenantId), eq(hrmsEmployees.id, employeeId)))
    .limit(1));
  return { payLevel: normalisePayLevel(rows[0]?.level) };
}
