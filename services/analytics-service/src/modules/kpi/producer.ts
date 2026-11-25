/**
 * KPI producer (D9 contract). Computes real KPIs from analytics' OWN projection
 * (analytics.fact_events) — no new pipeline, no other service's DB.
 *
 * D9: each KPI = { value, unit, target, direction, owner }.
 * D10: a KPI is visible only to viewers holding a role of its source module
 *      (or a tenant-wide analytics/admin role).
 *
 * Pure: `buildKpis` takes pre-aggregated rows so it is unit-testable w/o a DB.
 * A KPI with no underlying signal (source silent in the 60d window, or a ratio
 * with a zero denominator) is OMITTED — never faked as 0 or "—".
 */
export type KpiUnit = "paise" | "percent" | "count" | "days";
export type KpiDirection = "up_good" | "down_good";

/** One aggregate row: fact_events grouped by (source, eventType, status). */
export type FactAgg = {
  source: string;
  eventType: string;
  status: string;
  curCount: number;
  curSum: number; // paise
  prevCount: number;
  prevSum: number;
};

export type KpiOverride = { target?: number; owner?: string };

export type Kpi = {
  key: string;
  kpiName: string;
  category: string;
  module: string;
  value: number;
  unit: KpiUnit;
  target: number | null;
  direction: KpiDirection;
  owner: string;
  trendPct: number | null;
  status: "on_target" | "off_target" | "no_target";
  // Display strings consumed by the existing web KpiTable.
  currentValue: string;
  trend: string;
};

type Measure = { cur: number; prev: number };
type Def = {
  key: string;
  name: string;
  module: string; // `source` label in fact_events
  category: string;
  unit: KpiUnit;
  direction: KpiDirection;
  owner: string;
  measure: (a: FactAgg[]) => Measure | null;
};

const sel = (a: FactAgg[], source: string, eventType: string, status?: string) =>
  a.filter((r) => r.source === source && r.eventType === eventType && (status === undefined || r.status === status));
const cnt = (rows: FactAgg[]): Measure => ({
  cur: rows.reduce((s, r) => s + r.curCount, 0),
  prev: rows.reduce((s, r) => s + r.prevCount, 0),
});
const sum = (rows: FactAgg[]): Measure => ({
  cur: rows.reduce((s, r) => s + r.curSum, 0),
  prev: rows.reduce((s, r) => s + r.prevSum, 0),
});
/** num/den as percent; null when the current denominator is zero (no signal). */
function pct(num: Measure, den: Measure): Measure | null {
  if (den.cur <= 0) return null;
  const p = (n: number, d: number) => Math.round((n / d) * 1000) / 10;
  return { cur: p(num.cur, den.cur), prev: den.prev > 0 ? p(num.prev, den.prev) : Number.NaN };
}

export const KPI_DEFS: Def[] = [
  { key: "finance.payments_made_paise", name: "Payments Made (30d)", module: "finance", category: "Finance", unit: "paise", direction: "up_good", owner: "Finance Office",
    measure: (a) => sum(sel(a, "finance", "payment.made")) },
  { key: "finance.payments_made_count", name: "Payments Processed (30d)", module: "finance", category: "Finance", unit: "count", direction: "up_good", owner: "Finance Office",
    measure: (a) => cnt(sel(a, "finance", "payment.made")) },
  { key: "grants.disbursed_paise", name: "Grants Disbursed (30d)", module: "grants", category: "Grants", unit: "paise", direction: "up_good", owner: "Grants Office",
    measure: (a) => sum(sel(a, "grants", "disbursement.completed")) },
  { key: "grants.disbursements_count", name: "Grant Disbursements Completed (30d)", module: "grants", category: "Grants", unit: "count", direction: "up_good", owner: "Grants Office",
    measure: (a) => cnt(sel(a, "grants", "disbursement.completed")) },
  { key: "procurement.po_value_paise", name: "Purchase Orders Approved - Value (30d)", module: "procurement", category: "Procurement", unit: "paise", direction: "up_good", owner: "Procurement Office",
    measure: (a) => sum(sel(a, "procurement", "po.approved")) },
  { key: "procurement.po_count", name: "Purchase Orders Approved (30d)", module: "procurement", category: "Procurement", unit: "count", direction: "up_good", owner: "Procurement Office",
    measure: (a) => cnt(sel(a, "procurement", "po.approved")) },
  { key: "meeting.completed_count", name: "Meetings Completed (30d)", module: "meeting", category: "Governance", unit: "count", direction: "up_good", owner: "Committee Secretariat",
    measure: (a) => cnt(sel(a, "meeting", "meeting.completed")) },
  { key: "meeting.attendance_count", name: "Attendance Marked (30d)", module: "meeting", category: "Governance", unit: "count", direction: "up_good", owner: "Committee Secretariat",
    measure: (a) => cnt(sel(a, "meeting", "attendance.marked")) },
  { key: "court.cases_registered_count", name: "Cases Registered (30d)", module: "court", category: "Judiciary", unit: "count", direction: "up_good", owner: "Registrar",
    measure: (a) => cnt(sel(a, "court", "case.registered")) },
  // Ratio of disposals to registrations in the SAME window; disposed cases may
  // have been registered earlier, so it can exceed 100% — hence not a "rate".
  { key: "court.disposals_per_registration_pct", name: "Disposals per Registration (30d)", module: "court", category: "Judiciary", unit: "percent", direction: "up_good", owner: "Registrar",
    measure: (a) => pct(cnt(sel(a, "court", "case.status_changed", "disposed")), cnt(sel(a, "court", "case.registered"))) },
  { key: "court.hearings_scheduled_count", name: "Hearings Scheduled (30d)", module: "court", category: "Judiciary", unit: "count", direction: "up_good", owner: "Registrar",
    measure: (a) => cnt(sel(a, "court", "hearing.scheduled")) },
  { key: "visitor.checkins_count", name: "Visitor Check-ins (30d)", module: "visitor", category: "Premises", unit: "count", direction: "up_good", owner: "Security Office",
    measure: (a) => cnt(sel(a, "visitor", "checked_in")) },
  { key: "visitor.overstay_rate_pct", name: "Visitor Overstay Rate (30d)", module: "visitor", category: "Premises", unit: "percent", direction: "down_good", owner: "Security Office",
    measure: (a) => pct(cnt(sel(a, "visitor", "overstay.alerted")), cnt(sel(a, "visitor", "checked_in"))) },
];

/** D10: module roles that may see that module's KPIs (besides ADMIN_KPI_ROLES). */
export const MODULE_KPI_ROLES: Record<string, string[]> = {
  finance: ["finance_admin", "finance_officer", "audit_officer"],
  grants: ["grant_admin", "grant_officer", "finance_admin"],
  procurement: ["procurement_admin", "procurement_officer"],
  meeting: ["meeting_admin", "committee_secretary"],
  court: ["court_admin", "registrar", "judge"],
  visitor: ["security_admin", "facility_admin"],
};
/** Tenant-wide roles that see every module's KPIs. */
export const ADMIN_KPI_ROLES = ["analytics_admin", "tenant_admin", "super_admin", "platform_admin"];

export function canSeeModule(roles: readonly string[], module: string): boolean {
  if (roles.some((r) => ADMIN_KPI_ROLES.includes(r))) return true;
  const allowed = MODULE_KPI_ROLES[module] ?? [];
  return roles.some((r) => allowed.includes(r));
}

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export function formatKpiValue(value: number, unit: KpiUnit): string {
  switch (unit) {
    case "paise": return `₹${INR.format(Math.round(value / 100))}`;
    case "percent": return `${value}%`;
    case "days": return `${value}d`;
    default: return INR.format(value);
  }
}

function trendOf(cur: number, prev: number): number | null {
  if (!Number.isFinite(prev) || prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function statusOf(value: number, target: number | null, dir: KpiDirection): Kpi["status"] {
  if (target === null) return "no_target";
  return (dir === "up_good" ? value >= target : value <= target) ? "on_target" : "off_target";
}

/**
 * Build KPIs for a viewer. `overrides` maps KPI key -> tenant-configured
 * target/owner (from analytics.saved_metrics.spec). Targets are NEVER invented:
 * absent a tenant-configured target, target is null and status "no_target".
 */
export function buildKpis(
  aggs: FactAgg[],
  roles: readonly string[],
  overrides: Record<string, KpiOverride> = {},
): Kpi[] {
  const out: Kpi[] = [];
  for (const d of KPI_DEFS) {
    if (!canSeeModule(roles, d.module)) continue;
    // No signal at all from this source in the window => omit, don't fake 0.
    if (!aggs.some((r) => r.source === d.module && (r.curCount > 0 || r.prevCount > 0))) continue;
    const m = d.measure(aggs);
    if (!m || !Number.isFinite(m.cur)) continue;
    const ov = overrides[d.key];
    const target = typeof ov?.target === "number" && Number.isFinite(ov.target) ? ov.target : null;
    const tp = trendOf(m.cur, m.prev);
    out.push({
      key: d.key,
      kpiName: d.name,
      category: d.category,
      module: d.module,
      value: m.cur,
      unit: d.unit,
      target,
      direction: d.direction,
      owner: ov?.owner && ov.owner.length > 0 ? ov.owner : d.owner,
      trendPct: tp,
      status: statusOf(m.cur, target, d.direction),
      currentValue: formatKpiValue(m.cur, d.unit),
      trend: tp === null ? "—" : `${tp > 0 ? "+" : ""}${tp}% vs prior 30d`,
    });
  }
  return out;
}
