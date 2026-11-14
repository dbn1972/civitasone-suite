import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

export type StaffCostPeriod =
  | { period: string; suppressed: false; grossMinor: string; employerCostMinor: string; totalCostMinor: string; headcount: number }
  | { period: string; suppressed: true };
export type StaffCost = {
  projectCode: string;
  periods: StaffCostPeriod[];
  suppressedPeriods: number;
  /** Adds up the VISIBLE months only: a hidden month cannot be recovered as total minus the rest. */
  totals: { grossMinor: string; employerCostMinor: string; totalCostMinor: string };
};

const digits = (v: unknown): string | null => (typeof v === "string" && /^-?\d{1,18}$/.test(v) ? v : null);

/** Field-by-field: only these amounts are ever read from the response, never a spread of the body. A hidden month carries no amounts. */
export function mapStaffCost(p: unknown): StaffCost | null {
  const b = p as { projectCode?: unknown; periods?: unknown; totals?: Record<string, unknown> } | null;
  if (!b || !Array.isArray(b.periods) || !b.totals) return null;
  const periods: StaffCostPeriod[] = [];
  for (const r of b.periods as Array<Record<string, unknown>>) {
    if (typeof r.period !== "string") continue;
    if (r.suppressed === true) { periods.push({ period: r.period, suppressed: true }); continue; }
    const g = digits(r.grossMinor), e = digits(r.employerCostMinor), t = digits(r.totalCostMinor);
    if (g !== null && e !== null && t !== null) {
      periods.push({ period: r.period, suppressed: false, grossMinor: g, employerCostMinor: e, totalCostMinor: t, headcount: typeof r.headcount === "number" ? r.headcount : 0 });
    }
  }
  const g = digits(b.totals.grossMinor), e = digits(b.totals.employerCostMinor), t = digits(b.totals.totalCostMinor);
  if (g === null || e === null || t === null) return null;
  return {
    projectCode: typeof b.projectCode === "string" ? b.projectCode : "", periods, suppressedPeriods: periods.filter((x) => x.suppressed).length,
    totals: { grossMinor: g, employerCostMinor: e, totalCostMinor: t },
  };
}

export function getStaffCost(projectId: string, from: string, to: string): Promise<LoaderResult<StaffCost | null>> {
  return fetchJson<unknown, StaffCost | null>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/staff-cost?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, null,
    { telemetryKey: "projects.staff-cost", mapResponse: mapStaffCost });
}

/** Last 12 months ending this month, as YYYY-MM. */
export function defaultRange(now = new Date()): { from: string; to: string } {
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  return { from: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`, to };
}
