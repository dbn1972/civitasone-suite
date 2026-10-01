/**
 * Client-safe types and pure helpers for /hr/payroll/costing
 * (GAP-PAYROLL-COSTING-01/02/06). Shared by the server page/loaders and the
 * "use client" CreateCostingRuleForm, so this module must NEVER import
 * @/app/_data/apiClient (next/headers) or any other server-only module --
 * the server loaders live in costingData.ts.
 */

export type CostCenterOption = { id: string; code: string; name: string };

export type CostingRule = {
  id: string;
  employeeGroup: string;
  costCenterId: string;
  splitPct: number;
  status: string;
};

type RawRule = { id?: unknown; employee_group?: unknown; cost_center_id?: unknown; split_pct?: unknown; status?: unknown };
type RawReportRow = { employee_group?: unknown; cost_center_id?: unknown; split_pct?: unknown; allocated_minor?: unknown };
type RawCostCenter = { id?: unknown; code?: unknown; name?: unknown; isActive?: unknown };

export type CostCenterLabel = { label: string; resolved: boolean };

/**
 * GAP-PAYROLL-COSTING-01: the Cost Center column used to print
 * `CC-${uuid.split("-")[0]}` -- a fabricated code matching no master. Now
 * the real finance cost-centre code + name, or an explicit "Unresolved"
 * label carrying the full id so nobody mistakes it for a ledger code.
 */
export function costCenterLabel(
  id: string | null,
  centers: ReadonlyMap<string, CostCenterOption>,
  unresolved: (id: string) => string,
): CostCenterLabel {
  if (!id) return { label: unresolved("—"), resolved: false };
  const c = centers.get(id);
  return c ? { label: `${c.code} — ${c.name}`, resolved: true } : { label: unresolved(id), resolved: false };
}

/** Split percentages are NUMERIC(5,2): format "60" -> "60%", "33.5" -> "33.5%" (GAP-PAYROLL-COSTING-06). */
export function formatSplitPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${Number(v.toFixed(2))}%`;
}

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function mapRules(p: unknown): CostingRule[] | null {
  const arr = (p as { data?: RawRule[] } | null)?.data;
  if (!Array.isArray(arr)) return null;
  return arr
    .filter((r) => typeof r.id === "string" && typeof r.employee_group === "string" && typeof r.cost_center_id === "string")
    .map((r) => ({
      id: r.id as string,
      employeeGroup: r.employee_group as string,
      costCenterId: r.cost_center_id as string,
      splitPct: toNum(r.split_pct) ?? 0,
      status: typeof r.status === "string" ? r.status : "active",
    }));
}

export type ReportRow = { employeeGroup: string; costCenterId: string | null; splitPct: number | null; allocatedMinor: string | null };

export function mapReport(p: unknown): ReportRow[] | null {
  const arr = (p as { data?: RawReportRow[] } | null)?.data;
  if (!Array.isArray(arr)) return null;
  return arr.map((r) => ({
    employeeGroup: typeof r.employee_group === "string" ? r.employee_group : "",
    // Guarded: a null/non-string id used to crash the page via .split().
    costCenterId: typeof r.cost_center_id === "string" ? r.cost_center_id : null,
    splitPct: toNum(r.split_pct),
    allocatedMinor: typeof r.allocated_minor === "string" || typeof r.allocated_minor === "number" ? String(r.allocated_minor) : null,
  }));
}

export function mapCostCenters(p: unknown): CostCenterOption[] | null {
  const arr = Array.isArray(p) ? p : (p as { data?: RawCostCenter[] } | null)?.data;
  if (!Array.isArray(arr)) return null;
  return (arr as RawCostCenter[])
    .filter((c) => typeof c.id === "string" && typeof c.code === "string" && c.isActive !== false)
    .map((c) => ({ id: c.id as string, code: c.code as string, name: typeof c.name === "string" ? c.name : "" }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Sum of ACTIVE split % per employee group, rounded to 2dp (NUMERIC(5,2)). */
export function groupTotals(rules: readonly CostingRule[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of rules) {
    if (r.status !== "active") continue;
    totals.set(r.employeeGroup, Math.round(((totals.get(r.employeeGroup) ?? 0) + r.splitPct) * 100) / 100);
  }
  return totals;
}

/**
 * The group's total after saving a rule: the POST is an UPSERT on
 * (employee_group, cost_center_id), so an existing rule for the same pair is
 * replaced, not added to.
 */
export function projectedGroupTotal(
  rules: readonly CostingRule[],
  employeeGroup: string,
  costCenterId: string,
  splitPct: number,
): number {
  const others = rules
    .filter((r) => r.status === "active" && r.employeeGroup === employeeGroup && r.costCenterId !== costCenterId)
    .reduce((s, r) => s + r.splitPct, 0);
  return Math.round((others + splitPct) * 100) / 100;
}

