/**
 * GAP-HR-WFH-01: WFH eligibility by pay level.
 *
 * Source of the level: hrms_designations.level of the employee's designation --
 * the 7th CPC pay-matrix level (1-18; 0 is the "unclassified" sentinel, see
 * apps/web/src/lib/payLevels.ts and GAP-HR-DESIGNATIONS-01). The threshold and
 * the on/off switch are per-tenant policy (policy-settings key wfh_eligibility,
 * default: Level 10 and above = Group A = not eligible, per the repo's payLevels.ts).
 *
 * S8-G4: a tenant on private grade bands (policy pay_scale.kind = 'private_bands') has no 7th CPC levels.
 * For it the rank compared is the designation's BAND rank and the threshold is wfh_eligibility.maxBandRank
 * (default null = nobody is excluded: the gazetted exclusion is a government-service rule). A government
 * tenant never takes that branch, so its behaviour is unchanged.
 */
import { and, eq } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { hrmsEmployees, hrmsDesignations, hrmsGradeBands } from "../employee/schema.js";
import type { WfhEligibility, PayScaleKind } from "../policy-settings/registry.js";
import { getPolicy } from "../policy-settings/repo.js";
import { effectiveRank } from "../grade-bands/rank.js";

export type PayLevelResolution = {
  payLevel: number | null;
  /** S8-G4 -- present for every resolution made by resolveEmployeePayLevel; absent on hand-built ones. */
  scale?: PayScaleKind;
  /** S8-G4 -- the designation's band rank / code on a 'private_bands' tenant, else null. */
  bandRank?: number | null;
  bandCode?: string | null;
};

/** Level 0 / missing = unclassified: we do not know, so we do not guess. */
export function normalisePayLevel(level: number | null | undefined): number | null {
  return typeof level === "number" && Number.isInteger(level) && level >= 1 && level <= 18 ? level : null;
}

/**
 * True when the employee is excluded from WFH. `band` (from resolveEmployeePayLevel) switches the rule to the
 * band rank for a 'private_bands' tenant; without it this is exactly the original level comparison.
 */
export function isGazettedForWfh(
  payLevel: number | null, policy: WfhEligibility, band?: Pick<PayLevelResolution, "scale" | "bandRank">,
): boolean {
  if (!policy.enforceGazettedExclusion) return false;
  if (band?.scale === "private_bands") {
    const max = policy.maxBandRank ?? null;
    return max !== null && band.bandRank != null && band.bandRank > max;
  }
  if (payLevel === null) return false;
  return payLevel > policy.maxPayLevel;
}

export async function resolveEmployeePayLevel(tenantId: string, employeeId: string): Promise<PayLevelResolution> {
  const rows = await scopedRead((tx) => tx.select({
    level: hrmsDesignations.level,
    bandId: hrmsGradeBands.id, bandCode: hrmsGradeBands.code, bandName: hrmsGradeBands.name, bandRank: hrmsGradeBands.rank,
  })
    .from(hrmsEmployees)
    .innerJoin(hrmsDesignations, and(eq(hrmsDesignations.id, hrmsEmployees.designationId), eq(hrmsDesignations.tenantId, hrmsEmployees.tenantId)))
    .leftJoin(hrmsGradeBands, and(eq(hrmsGradeBands.id, hrmsDesignations.gradeBandId), eq(hrmsGradeBands.tenantId, hrmsDesignations.tenantId)))
    .where(and(eq(hrmsEmployees.tenantId, tenantId), eq(hrmsEmployees.id, employeeId)))
    .limit(1));
  const row = rows[0];
  const payLevel = normalisePayLevel(row?.level);
  const scale = (await getPolicy(tenantId, "pay_scale")).kind;
  if (scale !== "private_bands") return { payLevel, scale: "cpc7", bandRank: null, bandCode: null };
  const r = effectiveRank(scale, row?.level, row?.bandId ? { id: row.bandId, code: row.bandCode!, name: row.bandName!, rank: row.bandRank! } : null);
  return { payLevel, scale, bandRank: r.rank, bandCode: r.band?.code ?? null };
}
