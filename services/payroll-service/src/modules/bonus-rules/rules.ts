/**
 * GAP-PAYROLL-BONUS-02 -- Payment of Bonus Act, 1965 parameters per tenant
 * (statutory.bonus_rule_config, migration 0063), effective-dated.
 *
 *  - wage ceiling (s.12): bonus is computed on monthly wages up to the higher
 *    of Rs 7,000 or the applicable minimum wage; amounts above are ignored.
 *  - eligibility ceiling (s.2(13)): an employee drawing more than Rs 21,000 a
 *    month is not an "employee" for the Act (the figure is configurable: a
 *    notified revision is a new row).
 *  - min / max bonus (s.10 / s.11): 8.33% .. 20%.
 * Every field is NULL = not enforced, so with no configured row the legacy
 * bonus amounts are byte-identical. Whether the Act applies at all (most
 * Government departments are outside it, s.32) and which minimum wage governs
 * is the tenant's call: the suggested figures are pre-fills marked VERIFY.
 */
import { sql } from "drizzle-orm";
import type { db } from "../../shared/db.js";

export interface BonusRule {
  wageCeilingMinor: bigint | null;
  eligibilityCeilingMinor: bigint | null;
  minBonusBps: number | null;
  maxBonusBps: number | null;
  source: "tenant" | "none";
  effectiveFrom: string | null;
}

export const NO_BONUS_RULE: BonusRule = {
  wageCeilingMinor: null, eligibilityCeilingMinor: null, minBonusBps: null, maxBonusBps: null, source: "none", effectiveFrom: null,
};

/** Pre-fills only (never applied implicitly). VERIFY against the current Act / state minimum wage. */
export const SUGGESTED_BONUS_RULE = {
  wageCeilingMinor: "700000",          // Rs 7,000 / month (s.12; or the minimum wage if higher)
  eligibilityCeilingMinor: "2100000",  // Rs 21,000 / month (s.2(13), as amended 2015)
  minBonusBps: 833,
  maxBonusBps: 2000,
  note: "VERIFY: Payment of Bonus Act, 1965 s.2(13), s.10-12; the wage ceiling is the higher of Rs 7,000 and the applicable minimum wage",
} as const;

export interface BonusRuleRow {
  id: string; effectiveFrom: string;
  wageCeilingMinor: bigint | null; eligibilityCeilingMinor: bigint | null;
  minBonusBps: number | null; maxBonusBps: number | null;
  changeReason: string; createdAt: string; createdBy: string;
}

type DbRow = {
  id?: string; effective_from?: string; wage_ceiling_minor?: string | number | null; eligibility_ceiling_minor?: string | number | null;
  min_bonus_bps?: number | null; max_bonus_bps?: number | null; change_reason?: string; created_at?: string; created_by?: string;
};
const big = (v: string | number | null | undefined): bigint | null => (v == null ? null : BigInt(v));

export async function loadBonusRuleRows(tx: Pick<typeof db, "execute">, tenantId: string): Promise<BonusRuleRow[]> {
  const rows = (await tx.execute(sql`
    SELECT id, effective_from::text AS effective_from, wage_ceiling_minor, eligibility_ceiling_minor,
           min_bonus_bps, max_bonus_bps, change_reason, created_at::text AS created_at, created_by::text AS created_by
    FROM statutory.bonus_rule_config
    WHERE tenant_id = ${tenantId}::uuid
    ORDER BY effective_from DESC
  `)) as unknown as DbRow[];
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r.effective_from != null && r.id != null).map((r) => ({
    id: String(r.id), effectiveFrom: String(r.effective_from),
    wageCeilingMinor: big(r.wage_ceiling_minor), eligibilityCeilingMinor: big(r.eligibility_ceiling_minor),
    minBonusBps: r.min_bonus_bps == null ? null : Number(r.min_bonus_bps), maxBonusBps: r.max_bonus_bps == null ? null : Number(r.max_bonus_bps),
    changeReason: String(r.change_reason ?? ""), createdAt: String(r.created_at ?? ""), createdBy: String(r.created_by ?? ""),
  }));
}

/** Latest row effective on/before `asOf` (YYYY-MM-DD), else no rule. Pure. */
export function resolveBonusRule(rows: BonusRuleRow[], asOf: string): BonusRule {
  const latest = rows.filter((r) => r.effectiveFrom <= asOf)
    .reduce<BonusRuleRow | undefined>((b, r) => (!b || r.effectiveFrom > b.effectiveFrom ? r : b), undefined);
  if (!latest) return NO_BONUS_RULE;
  return {
    wageCeilingMinor: latest.wageCeilingMinor, eligibilityCeilingMinor: latest.eligibilityCeilingMinor,
    minBonusBps: latest.minBonusBps, maxBonusBps: latest.maxBonusBps, source: "tenant", effectiveFrom: latest.effectiveFrom,
  };
}

export async function loadBonusRule(tx: Pick<typeof db, "execute">, tenantId: string, asOf: string): Promise<BonusRule> {
  return resolveBonusRule(await loadBonusRuleRows(tx, tenantId), asOf);
}

/** Why `basicMinor` / `bonusPctBps` is not allowed under the rule, or null. Pure. */
export function bonusRuleViolation(rule: BonusRule, basicMinor: bigint, bonusPctBps: number): string | null {
  if (rule.eligibilityCeilingMinor != null && basicMinor > rule.eligibilityCeilingMinor) {
    return "basic wages exceed the Payment of Bonus Act eligibility ceiling configured for this tenant";
  }
  if (rule.minBonusBps != null && bonusPctBps < rule.minBonusBps) return "bonus percentage is below the configured statutory minimum";
  if (rule.maxBonusBps != null && bonusPctBps > rule.maxBonusBps) return "bonus percentage is above the configured statutory maximum";
  return null;
}

/** Wages the bonus is computed on: capped at the calculation ceiling when one is configured. Pure. */
export function bonusWagesMinor(rule: BonusRule, basicMinor: bigint): bigint {
  return rule.wageCeilingMinor != null && basicMinor > rule.wageCeilingMinor ? rule.wageCeilingMinor : basicMinor;
}

export function serializeBonusRule(r: BonusRule) {
  return {
    wageCeilingMinor: r.wageCeilingMinor?.toString() ?? null,
    eligibilityCeilingMinor: r.eligibilityCeilingMinor?.toString() ?? null,
    minBonusBps: r.minBonusBps, maxBonusBps: r.maxBonusBps, source: r.source, effectiveFrom: r.effectiveFrom,
  };
}
