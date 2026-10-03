/**
 * GAP-PAYROLL-STATUTORY-GRATUITY-01/04 -- per-edition gratuity rule set.
 *
 * Editions are entitlements, not code forks (CLAUDE.md), so the gratuity /
 * DCRG formula is selected by a tenant-configurable, effective-dated row in
 * statutory.gratuity_rule_config (migration 0061) instead of being hard-coded:
 *
 *  pog_act  (default; PSU / small office / private establishment)
 *    Payment of Gratuity Act, 1972 s.4(2) -- (15/26) x last drawn wages
 *    (Basic+DA) x completed years of service, a part of a year over six
 *    months counted as a full year; 5 years continuous service required
 *    (s.4(1), waived on death / disablement); statutory ceiling s.4(3)
 *    (Rs 20,00,000). Delegates to payroll/domain.ts computeGratuity so the
 *    legacy figures stay byte-identical.
 *
 *  ccs_dcrg (Government Department)
 *    CCS (Pension) Rules -- Death-cum-Retirement Gratuity (Rules 50-51 of the
 *    1972 rules, renumbered in the 2021 rules; VERIFY the clause numbers):
 *      retirement / invalidation : 1/4 x emoluments (Basic+DA) x COMPLETED
 *        SIX-MONTHLY PERIODS (no rounding up of a part period), at most 66
 *        periods (33 years) and at most 16.5 x emoluments;
 *      death in service: <1 yr 2x, 1..<5 yrs 6x, 5..<11 yrs 12x, 11..<20 yrs
 *        20x, >=20 yrs 1/2 x emoluments x completed half-years (max 33x).
 *    Ceiling: Rs 25,00,000 with effect from 1 Jan 2024 (DoPT, on DA reaching
 *    50%); stored per row so a later notification is a new row.
 *    VERIFY with the pension owner before enabling for a Government tenant.
 */
import { sql } from "drizzle-orm";
import type { db } from "../../shared/db.js";
import { completedYearsPgAct, computeGratuity, roundRupee } from "../payroll/domain.js";

export type GratuityRuleSet = "pog_act" | "ccs_dcrg";
export const GRATUITY_RULE_SETS: readonly GratuityRuleSet[] = ["pog_act", "ccs_dcrg"];

export const POG_ACT_CEILING_MINOR = 200_000_000n; // Rs 20,00,000
/**
 * DCRG ceiling is date-dependent per the DoP&PW Office Memorandum raising the
 * retirement / death gratuity ceiling to Rs 25 lakh once DA reached 50% (VERIFY
 * the OM number/date): Rs 20,00,000 for a retirement / death BEFORE 1-Jan-2024,
 * Rs 25,00,000 from 1-Jan-2024. Mirrored in hrms-service pension/engine.ts
 * (dcrgAbsoluteCapMinor) because services cannot import each other.
 */
export const CCS_DCRG_CEILING_PRE_2024_MINOR = 200_000_000n; // Rs 20,00,000
export const CCS_DCRG_CEILING_MINOR = 250_000_000n; // Rs 25,00,000 (from 1 Jan 2024)
export const CCS_DCRG_CEILING_REVISION_DATE = "2024-01-01";

export interface GratuityRule {
  ruleSet: GratuityRuleSet;
  minServiceYears: number;
  ceilingMinor: bigint;
  /** where the rule came from: a tenant row, or the built-in default. */
  source: "tenant" | "default";
  effectiveFrom: string | null;
}

/** Built-in default: the pre-existing behaviour (Payment of Gratuity Act, 1972). */
export const DEFAULT_GRATUITY_RULE: GratuityRule = {
  ruleSet: "pog_act",
  minServiceYears: 5,
  ceilingMinor: POG_ACT_CEILING_MINOR,
  source: "default",
  effectiveFrom: null,
};

/** Suggested per-rule-set parameters, offered as form pre-fills (never applied implicitly). */
export const SUGGESTED_GRATUITY_RULES: Record<GratuityRuleSet, { minServiceYears: number; ceilingMinor: string; citation: string }> = {
  pog_act: { minServiceYears: 5, ceilingMinor: POG_ACT_CEILING_MINOR.toString(), citation: "Payment of Gratuity Act, 1972 s.4 (VERIFY if the Code on Social Security, 2020 s.53 is in force)" },
  ccs_dcrg: { minServiceYears: 5, ceilingMinor: CCS_DCRG_CEILING_MINOR.toString(), citation: "CCS (Pension) Rules DCRG; ceiling Rs 25 lakh from 1 Jan 2024 (VERIFY against the latest DoPT OM)" },
};

const DCRG_MAX_HALF_YEARS = 66n; // 33 years
const DEATH_SEPARATION = "death";
/**
 * CCS DCRG is payable on retirement-type exits and on death in service only
 * (CCS (Pension) Rules: retirement gratuity on superannuation / voluntary /
 * compulsory retirement / invalidation; death gratuity on death in service).
 * Resignation, dismissal and removal forfeit past service, so they get no
 * DCRG; an absent or unrecognised separation type is not on the allow-list
 * either (fail-safe). VERIFY the list with the pension owner.
 */
const DCRG_RETIREMENT_TYPES: ReadonlySet<string> = new Set([
  "retirement", "superannuation", "voluntary_retirement", "vrs", "compulsory_retirement",
  "premature_retirement", "invalidation", "disablement", "disability", "medical_invalidation",
]);
export function dcrgPayableOnSeparation(separationType?: string | null): boolean {
  const sep = (separationType ?? "").toLowerCase();
  return sep === DEATH_SEPARATION || DCRG_RETIREMENT_TYPES.has(sep);
}

/** Rule ceiling, clamped to the pre-2024 Rs 20 lakh for a retirement / death before 1-Jan-2024. */
export function dcrgCeilingForDate(ruleCeilingMinor: bigint, separationDateISO?: string | null): bigint {
  if (separationDateISO && separationDateISO.slice(0, 10) < CCS_DCRG_CEILING_REVISION_DATE
      && CCS_DCRG_CEILING_PRE_2024_MINOR < ruleCeilingMinor) {
    return CCS_DCRG_CEILING_PRE_2024_MINOR;
  }
  return ruleCeilingMinor;
}
const DISABLEMENT_WAIVED = new Set(["disablement", "disability", "invalidation"]);

export function isGratuityRuleSet(v: unknown): v is GratuityRuleSet {
  return v === "pog_act" || v === "ccs_dcrg";
}

/**
 * Gratuity / DCRG payable (paise) under `rule`.
 * @param yearsOfService continuous / qualifying service in years (fractional)
 * @param basicMinor last drawn Basic (paise)
 * @param daMinor Dearness Allowance on it (paise)
 */
export function computeGratuityByRule(
  rule: GratuityRule,
  yearsOfService: number,
  basicMinor: bigint,
  daMinor: bigint,
  separationType?: string | null,
  /** separation / retirement / death date (YYYY-MM-DD): selects the date-dependent DCRG ceiling. */
  separationDate?: string | null,
): bigint {
  if (rule.ruleSet === "pog_act") {
    const isDefault = rule.minServiceYears === DEFAULT_GRATUITY_RULE.minServiceYears && rule.ceilingMinor === POG_ACT_CEILING_MINOR;
    return isDefault
      ? computeGratuity(yearsOfService, basicMinor, daMinor, separationType)
      : computeGratuity(yearsOfService, basicMinor, daMinor, separationType, { minServiceYears: rule.minServiceYears, ceilingMinor: rule.ceilingMinor });
  }
  const sep = (separationType ?? "").toLowerCase();
  if (!dcrgPayableOnSeparation(sep)) return 0n;
  const emoluments = basicMinor + daMinor;
  // Qualifying service (CCS (Pension) Rules, 2021 -- rule on computation of
  // qualifying service; VERIFY the rule number): a fraction of a six-monthly
  // period of 3 months or more counts as a completed half-year, less than 3
  // months is dropped.
  const half = Math.max(0, yearsOfService * 2);
  const whole = Math.floor(half + 1e-9);
  const halfYearsRaw = BigInt(whole + (half - whole >= 0.5 - 1e-9 ? 1 : 0));
  const halfYears = halfYearsRaw > DCRG_MAX_HALF_YEARS ? DCRG_MAX_HALF_YEARS : halfYearsRaw;
  let raw: bigint;
  if (sep === DEATH_SEPARATION) {
    // Death gratuity table (death while in service).
    if (halfYears < 2n) raw = emoluments * 2n;
    else if (halfYears < 10n) raw = emoluments * 6n;
    else if (halfYears < 22n) raw = emoluments * 12n;
    else if (halfYears < 40n) raw = emoluments * 20n;
    else raw = (emoluments * halfYears) / 2n;
    const max33x = emoluments * 33n;
    if (raw > max33x) raw = max33x;
  } else {
    if (yearsOfService < rule.minServiceYears && !DISABLEMENT_WAIVED.has(sep)) return 0n;
    raw = (emoluments * halfYears) / 4n;
    const max165x = (emoluments * 33n) / 2n; // 16.5 x emoluments
    if (raw > max165x) raw = max165x;
  }
  const rounded = roundRupee(raw);
  const ceiling = dcrgCeilingForDate(rule.ceilingMinor, separationDate);
  return rounded > ceiling ? ceiling : rounded;
}

/**
 * Continuous service in years as whole calendar months / 12 (so an exact
 * anniversary is exact, unlike elapsed-days / 365.25 which falls a fraction
 * short and would drop a completed six-monthly period). The LAST DAY IS
 * INCLUSIVE (service through 31-Dec-2019 from 1-Jan-2000 is 20 years). Used
 * for DCRG, which counts completed half-years.
 */
export function calendarServiceYears(joined: Date, lastDay: Date): number {
  const separated = new Date(lastDay.getTime() + 86_400_000); // exclusive end = last day + 1
  let months = (separated.getUTCFullYear() - joined.getUTCFullYear()) * 12 + (separated.getUTCMonth() - joined.getUTCMonth());
  if (separated.getUTCDate() < joined.getUTCDate()) months -= 1;
  return Math.max(0, months) / 12;
}

/** Completed-years figure the rule counts (PoG Act rounds up past 6 months; DCRG counts whole half-years). */
export function completedServiceYearsByRule(rule: GratuityRule, yearsOfService: number): number {
  return rule.ruleSet === "pog_act" ? completedYearsPgAct(yearsOfService) : Math.floor(yearsOfService * 2 + 1e-9) / 2;
}

export interface GratuityRuleRow {
  id: string;
  effectiveFrom: string;
  ruleSet: GratuityRuleSet;
  minServiceYears: number;
  ceilingMinor: bigint;
  changeReason: string;
  createdAt: string;
  createdBy: string;
}

type DbRow = {
  id?: string; effective_from?: string; rule_set?: string; min_service_years?: number | string;
  ceiling_minor?: string | number; change_reason?: string; created_at?: string; created_by?: string;
};

function toRows(rows: DbRow[]): GratuityRuleRow[] {
  const out: GratuityRuleRow[] = [];
  for (const r of rows) {
    if (!isGratuityRuleSet(r.rule_set) || r.effective_from == null || r.ceiling_minor == null) continue;
    out.push({
      id: String(r.id), effectiveFrom: String(r.effective_from), ruleSet: r.rule_set,
      minServiceYears: Number(r.min_service_years ?? 5), ceilingMinor: BigInt(r.ceiling_minor),
      changeReason: String(r.change_reason ?? ""), createdAt: String(r.created_at ?? ""), createdBy: String(r.created_by ?? ""),
    });
  }
  return out;
}

/** Every rule row of the tenant, newest effective date first. Must run in a tenant-scoped tx (FORCE RLS). */
export async function loadGratuityRuleRows(tx: Pick<typeof db, "execute">, tenantId: string): Promise<GratuityRuleRow[]> {
  const rows = (await tx.execute(sql`
    SELECT id, effective_from::text AS effective_from, rule_set, min_service_years, ceiling_minor,
           change_reason, created_at::text AS created_at, created_by::text AS created_by
    FROM statutory.gratuity_rule_config
    WHERE tenant_id = ${tenantId}::uuid
    ORDER BY effective_from DESC
  `)) as unknown as DbRow[];
  return toRows(Array.isArray(rows) ? rows : []);
}

/** Latest row effective on/before `asOf` (YYYY-MM-DD), else the built-in default. Pure. */
export function resolveGratuityRule(rows: GratuityRuleRow[], asOf: string): GratuityRule {
  const eligible = rows.filter((r) => r.effectiveFrom <= asOf);
  const latest = eligible.reduce<GratuityRuleRow | undefined>((b, r) => (!b || r.effectiveFrom > b.effectiveFrom ? r : b), undefined);
  if (!latest) return DEFAULT_GRATUITY_RULE;
  return { ruleSet: latest.ruleSet, minServiceYears: latest.minServiceYears, ceilingMinor: latest.ceilingMinor, source: "tenant", effectiveFrom: latest.effectiveFrom };
}

export async function loadGratuityRule(tx: Pick<typeof db, "execute">, tenantId: string, asOf: string): Promise<GratuityRule> {
  return resolveGratuityRule(await loadGratuityRuleRows(tx, tenantId), asOf);
}

export function serializeGratuityRule(r: GratuityRule) {
  return {
    ruleSet: r.ruleSet, minServiceYears: r.minServiceYears, ceilingMinor: r.ceilingMinor.toString(),
    source: r.source, effectiveFrom: r.effectiveFrom,
  };
}
