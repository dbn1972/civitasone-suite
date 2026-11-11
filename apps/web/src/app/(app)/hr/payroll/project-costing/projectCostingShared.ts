/**
 * Client-safe types, role lists and pure helpers for /hr/payroll/project-costing
 * (S8 G7). Shared by the server page/loaders and the "use client" forms, so this
 * module must NEVER import apiClient (next/headers) - the loaders live in
 * projectCostingData.ts.
 *
 * Roles mirror payroll-service project-costing/routes.ts. A project manager is
 * in NONE of these lists: individual pay and payroll-side costing are not theirs,
 * they read their own project's totals on /projects/[id]/staff-cost.
 */

export const PROJECT_COSTING_TOTALS_ROLES = ["payroll_admin", "payroll_officer", "finance_admin", "finance_officer", "super_admin"];
export const PROJECT_COSTING_WRITE_ROLES = ["payroll_admin", "payroll_officer", "hr_admin", "super_admin"];
export const PROJECT_COSTING_APPROVE_ROLES = ["payroll_admin", "finance_admin", "super_admin"];
export const PROJECT_COSTING_VIEW_ROLES = [...new Set([...PROJECT_COSTING_TOTALS_ROLES, ...PROJECT_COSTING_WRITE_ROLES, ...PROJECT_COSTING_APPROVE_ROLES])];

export type CostCenterOption = { id: string; code: string; name: string };
export type ProjectOption = { projectId: string; code: string; name: string; costCenterId: string | null };

export type Allocation = {
  id: string;
  employeeId: string;
  targetType: "project" | "cost_center";
  projectId: string | null;
  costCenterId: string;
  splitPct: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "pending" | "active" | "rejected";
  requestedBy: string;
};

export type ProjectCostRow = { period: string; projectId: string; grossMinor: string; employerCostMinor: string; totalCostMinor: string; headcount: number };
export type CostCenterCostRow = { period: string; costCenterId: string; grossMinor: string; employerCostMinor: string; totalCostMinor: string; headcount: number };
export type UnallocatedRow = { period: string; grossMinor: string; employerCostMinor: string; totalCostMinor: string; headcount: number };

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const digits = (v: unknown): string | null => (typeof v === "string" && /^-?\d{1,18}$/.test(v) ? v : null);

export function mapSettings(p: unknown): { enabled: boolean } | null {
  const d = (p as { data?: { enabled?: unknown } } | null)?.data;
  return d && typeof d.enabled === "boolean" ? { enabled: d.enabled } : null;
}

export function mapAllocations(p: unknown): Allocation[] | null {
  const arr = (p as { data?: unknown } | null)?.data;
  if (!Array.isArray(arr)) return null;
  const out: Allocation[] = [];
  for (const r of arr as Array<Record<string, unknown>>) {
    const id = str(r.id), employeeId = str(r.employeeId), costCenterId = str(r.costCenterId), from = str(r.effectiveFrom), splitPct = str(r.splitPct);
    if (!id || !employeeId || !costCenterId || !from || !splitPct) continue;
    const status = r.status === "active" || r.status === "rejected" ? r.status : "pending";
    out.push({
      id, employeeId, costCenterId, splitPct, effectiveFrom: from, effectiveTo: str(r.effectiveTo), status,
      targetType: r.targetType === "cost_center" ? "cost_center" : "project", projectId: str(r.projectId), requestedBy: str(r.requestedBy) ?? "",
    });
  }
  return out;
}

export function mapByProject(p: unknown): ProjectCostRow[] | null {
  const arr = (p as { data?: unknown } | null)?.data;
  if (!Array.isArray(arr)) return null;
  const out: ProjectCostRow[] = [];
  for (const r of arr as Array<Record<string, unknown>>) {
    const period = str(r.period), projectId = str(r.projectId), g = digits(r.grossMinor), e = digits(r.employerCostMinor), t = digits(r.totalCostMinor);
    if (!period || !projectId || g === null || e === null || t === null) continue;
    out.push({ period, projectId, grossMinor: g, employerCostMinor: e, totalCostMinor: t, headcount: typeof r.headcount === "number" ? r.headcount : 0 });
  }
  return out;
}

export function mapByCostCenter(p: unknown): { data: CostCenterCostRow[]; unallocated: UnallocatedRow[] } | null {
  const body = p as { data?: unknown; unallocated?: unknown } | null;
  if (!body || !Array.isArray(body.data)) return null;
  const shape = (r: Record<string, unknown>) => ({
    period: str(r.period), g: digits(r.grossMinor), e: digits(r.employerCostMinor), t: digits(r.totalCostMinor), heads: typeof r.headcount === "number" ? r.headcount : 0,
  });
  const data: CostCenterCostRow[] = [];
  for (const r of body.data as Array<Record<string, unknown>>) {
    const s = shape(r), cc = str(r.costCenterId);
    if (s.period && cc && s.g !== null && s.e !== null && s.t !== null) data.push({ period: s.period, costCenterId: cc, grossMinor: s.g, employerCostMinor: s.e, totalCostMinor: s.t, headcount: s.heads });
  }
  const unallocated: UnallocatedRow[] = [];
  for (const r of (Array.isArray(body.unallocated) ? body.unallocated : []) as Array<Record<string, unknown>>) {
    const s = shape(r);
    if (s.period && s.g !== null && s.e !== null && s.t !== null) unallocated.push({ period: s.period, grossMinor: s.g, employerCostMinor: s.e, totalCostMinor: s.t, headcount: s.heads });
  }
  return { data, unallocated };
}

export function mapProjectIndex(p: unknown): ProjectOption[] | null {
  const arr = (p as { data?: unknown } | null)?.data;
  if (!Array.isArray(arr)) return null;
  const out: ProjectOption[] = [];
  for (const r of arr as Array<Record<string, unknown>>) {
    const projectId = str(r.projectId), code = str(r.code), name = str(r.name);
    if (projectId && code && name) out.push({ projectId, code, name, costCenterId: str(r.costCenterId) });
  }
  return out;
}

export function mapCostCenters(p: unknown): CostCenterOption[] | null {
  const arr = Array.isArray(p) ? p : (p as { data?: unknown } | null)?.data;
  if (!Array.isArray(arr)) return null;
  return (arr as Array<Record<string, unknown>>)
    .filter((c) => typeof c.id === "string" && typeof c.code === "string" && c.isActive !== false)
    .map((c) => ({ id: c.id as string, code: c.code as string, name: typeof c.name === "string" ? c.name : "" }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** 0 < pct <= 100 with at most 2 decimals, as a number; null when invalid. */
export function parseAllocationPct(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 100 ? n : null;
}

const isoDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Returns an i18n key under `projectCosting` for the first problem, or null when the dates are usable. */
export function validateAllocationDates(from: string, to: string): "fromRequiredError" | "dateInvalidError" | "toBeforeFromError" | null {
  if (!from) return "fromRequiredError";
  if (!isoDate(from) || (to && !isoDate(to))) return "dateInvalidError";
  if (to && to < from) return "toBeforeFromError";
  return null;
}

/** The target costing line type of an allocation in plain terms for a label. */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
