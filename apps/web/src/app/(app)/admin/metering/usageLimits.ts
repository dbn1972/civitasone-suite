import type { UsageResource } from "@/app/_data/loaders";

/**
 * GAP-ADMIN-METERING-05: compare consumption with the plan limit.
 *
 * The comparison uses tenant-service's own `used` and `limit` for a resource
 * (GET /v1/admin/usage), which share a unit by construction. Billing's metered
 * totals (a monthly sum) are NOT compared with a daily limit, which is exactly
 * how a false "over limit" warning would be produced.
 *
 * VERIFY: the metering columns map to quota resources as
 *   users -> "users", storage -> "storage_gb", apiCalls -> "api_calls_daily" (a per-day limit).
 */
export type LimitLevel = "none" | "ok" | "warn" | "bad";

export type LimitCell = {
  resource: string;
  label: string;
  used: number | null;
  limit: number | null;
  unit: string;
  /** Whole percent, or null when there is no usable limit. */
  percent: number | null;
  level: LimitLevel;
  /** Always carries a text cue (never colour alone). */
  text: string;
};

export const WARN_AT_PERCENT = 80;
export const BAD_AT_PERCENT = 100;

/** Tenant at or above 80% warns; at or above 100% is over limit. No limit (or 0) never divides: it is "—". */
export function limitCell(r: Pick<UsageResource, "resource" | "label" | "used" | "limit" | "unit">): LimitCell {
  const base = { resource: r.resource, label: r.label, unit: r.unit };
  const used = Number.isFinite(r.used) ? r.used : null;
  const limit = Number.isFinite(r.limit) && r.limit > 0 ? r.limit : null;
  if (used === null || limit === null) {
    return { ...base, used, limit, percent: null, level: "none", text: "—" };
  }
  const percent = Math.round((used / limit) * 100);
  const level: LimitLevel = percent >= BAD_AT_PERCENT ? "bad" : percent >= WARN_AT_PERCENT ? "warn" : "ok";
  const text = level === "bad" ? `${percent}% of limit - over limit` : `${percent}% of limit`;
  return { ...base, used, limit, percent, level, text };
}

export function limitCells(resources: readonly UsageResource[]): LimitCell[] {
  return resources.map(limitCell);
}
