/**
 * PAY-PROFILES: effective-dated allowance rules (migration 0054,
 * statutory.allowance_rule_config) -- the 7th CPC HRA minimum floor per city
 * class and the Option A deputation-allowance rule per station type.
 *
 * Resolution is FIELD-level (unlike statutory_config's row-level pick): for
 * each field, the tenant's latest non-null value effective on/before the
 * period wins, else the platform default's (sentinel tenant), else "none"
 * (floor 0n / rule null). A deputation rule is a (rate, cap) pair resolved
 * as a unit. Pure apart from the loader.
 */
import { sql } from "drizzle-orm";
import type { db } from "../../shared/db.js";
import type { CityClass, DeputationAllowanceRule, DeputationStationType } from "../payroll/domain.js";

export const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";

export interface AllowanceRuleRow {
  tenantId: string | null;           // null == platform default
  effectiveFrom: string;             // YYYY-MM-DD (1st of a month)
  hraFloorXMinor: bigint | null;
  hraFloorYMinor: bigint | null;
  hraFloorZMinor: bigint | null;
  depSameBps: bigint | null;
  depSameCapMinor: bigint | null;
  depOtherBps: bigint | null;
  depOtherCapMinor: bigint | null;
}

export type RuleSource = "tenant" | "platform" | "none";

export interface AllowanceRules {
  hraFloorMinor: Record<CityClass, bigint>;
  deputation: Record<DeputationStationType, DeputationAllowanceRule | null>;
  sources: {
    hraFloor: Record<CityClass, RuleSource>;
    deputation: Record<DeputationStationType, RuleSource>;
  };
}

export const NO_ALLOWANCE_RULES: AllowanceRules = {
  hraFloorMinor: { X: 0n, Y: 0n, Z: 0n },
  deputation: { same: null, other: null },
  sources: { hraFloor: { X: "none", Y: "none", Z: "none" }, deputation: { same: "none", other: "none" } },
};

/**
 * Values commonly cited for the post-7th-CPC deputation (duty) allowance.
 * NOT seeded and NOT authoritative: offered to administrators as a pre-fill,
 * to be verified against the current DoPT OM before saving.
 */
export const SUGGESTED_DEPUTATION_RULES = {
  same: { rateBps: 500, capMinor: "450000" },
  other: { rateBps: 1000, capMinor: "900000" },
  note: "VERIFY against current DoPT OM before use",
} as const;

function pick<T>(
  rows: AllowanceRuleRow[], tenantId: string, periodStart: string,
  get: (r: AllowanceRuleRow) => T | null,
): { value: T; source: RuleSource } | null {
  const eligible = rows.filter((r) => r.effectiveFrom <= periodStart && get(r) != null);
  const latest = (cands: AllowanceRuleRow[]) =>
    cands.reduce<AllowanceRuleRow | undefined>((b, r) => (!b || r.effectiveFrom > b.effectiveFrom ? r : b), undefined);
  const t = latest(eligible.filter((r) => r.tenantId === tenantId));
  if (t) return { value: get(t) as T, source: "tenant" };
  const p = latest(eligible.filter((r) => r.tenantId === null));
  if (p) return { value: get(p) as T, source: "platform" };
  return null;
}

export function resolveAllowanceRules(rows: AllowanceRuleRow[], tenantId: string, periodMonth: string): AllowanceRules {
  const start = `${periodMonth}-01`;
  const floor = (get: (r: AllowanceRuleRow) => bigint | null) => pick(rows, tenantId, start, get);
  const fx = floor((r) => r.hraFloorXMinor);
  const fy = floor((r) => r.hraFloorYMinor);
  const fz = floor((r) => r.hraFloorZMinor);
  const same = pick(rows, tenantId, start, (r) =>
    r.depSameBps != null && r.depSameCapMinor != null ? { rateBps: r.depSameBps, capMinor: r.depSameCapMinor } : null);
  const other = pick(rows, tenantId, start, (r) =>
    r.depOtherBps != null && r.depOtherCapMinor != null ? { rateBps: r.depOtherBps, capMinor: r.depOtherCapMinor } : null);
  return {
    hraFloorMinor: { X: fx?.value ?? 0n, Y: fy?.value ?? 0n, Z: fz?.value ?? 0n },
    deputation: { same: same?.value ?? null, other: other?.value ?? null },
    sources: {
      hraFloor: { X: fx?.source ?? "none", Y: fy?.source ?? "none", Z: fz?.source ?? "none" },
      deputation: { same: same?.source ?? "none", other: other?.source ?? "none" },
    },
  };
}

type DbRow = {
  id: string; tenant_id: string; effective_from: string;
  hra_floor_x_minor: string | number | null; hra_floor_y_minor: string | number | null; hra_floor_z_minor: string | number | null;
  dep_allow_same_station_bps: string | number | null; dep_allow_same_station_cap_minor: string | number | null;
  dep_allow_other_station_bps: string | number | null; dep_allow_other_station_cap_minor: string | number | null;
  change_reason: string; created_at: string; created_by: string;
};

const big = (v: string | number | null): bigint | null => (v == null ? null : BigInt(v));

export interface AllowanceRuleHistoryRow extends AllowanceRuleRow {
  id: string; changeReason: string; createdAt: string; createdBy: string;
}

/**
 * Every rule row visible to the tenant (its own + platform default). Must run
 * inside a tenant-scoped transaction (scopedRead / the run's tx): the table is
 * FORCE RLS, so a bare pooled read would silently see nothing.
 */
export async function loadAllowanceRuleRows(tx: Pick<typeof db, "execute">, tenantId: string): Promise<AllowanceRuleHistoryRow[]> {
  const rows = (await tx.execute(sql`
    SELECT id, tenant_id, effective_from::text AS effective_from,
           hra_floor_x_minor, hra_floor_y_minor, hra_floor_z_minor,
           dep_allow_same_station_bps, dep_allow_same_station_cap_minor,
           dep_allow_other_station_bps, dep_allow_other_station_cap_minor,
           change_reason, created_at::text AS created_at, created_by
    FROM statutory.allowance_rule_config
    WHERE tenant_id IN (${tenantId}::uuid, ${PLATFORM_TENANT_ID}::uuid)
    ORDER BY effective_from DESC, tenant_id
  `)) as unknown as DbRow[];
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id === PLATFORM_TENANT_ID ? null : r.tenant_id,
    effectiveFrom: r.effective_from,
    hraFloorXMinor: big(r.hra_floor_x_minor),
    hraFloorYMinor: big(r.hra_floor_y_minor),
    hraFloorZMinor: big(r.hra_floor_z_minor),
    depSameBps: big(r.dep_allow_same_station_bps),
    depSameCapMinor: big(r.dep_allow_same_station_cap_minor),
    depOtherBps: big(r.dep_allow_other_station_bps),
    depOtherCapMinor: big(r.dep_allow_other_station_cap_minor),
    changeReason: r.change_reason,
    createdAt: r.created_at,
    createdBy: r.created_by,
  }));
}
