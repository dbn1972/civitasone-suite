/**
 * Server-side loaders for Admin > Plans, modules and prices (M6). Go through the gateway to tenant-service
 * (/api/v1/plans). A failed load is `source: "error"` with empty data, never an empty list.
 */
import { fetchJson, type LoaderResult } from "./apiClient";

export interface PlanModulesView {
  planId: string;
  planCode: string;
  source: "catalogue_modules" | "enabled_modules";
  selected: string[];
  pulledIn: string[];
  moduleIds: string[];
}

export interface PlanQuoteLine { kind: "plan" | "addon"; key: string; gstRateBps: number; netMinor: string; gstMinor: string; grossMinor: string }
export interface PlanQuoteView { onDate: string; billingCycle: string; lines: PlanQuoteLine[]; totals: { netMinor: string; gstMinor: string; grossMinor: string } }
export interface PlanListRow { id: string; code: string; name: string }

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function getPlanList(): Promise<LoaderResult<PlanListRow[]>> {
  return fetchJson<unknown, PlanListRow[]>("/api/v1/plans", [], {
    telemetryKey: "plans.list",
    mapResponse: (p) => {
      const rows = Array.isArray(p) ? p : isRec(p) && Array.isArray(p.data) ? p.data : null;
      if (!rows) return null;
      return rows.filter(isRec).filter((r) => typeof r.id === "string" && typeof r.code === "string")
        .map((r) => ({ id: String(r.id), code: String(r.code), name: typeof r.name === "string" ? r.name : String(r.code) }));
    },
  });
}

export function getPlanModules(planId: string): Promise<LoaderResult<PlanModulesView | null>> {
  return fetchJson<unknown, PlanModulesView | null>(`/api/v1/plans/${encodeURIComponent(planId)}/modules`, null, {
    telemetryKey: "plans.modules",
    mapResponse: (p) => {
      if (!isRec(p) || typeof p.planCode !== "string") return null;
      return {
        planId, planCode: p.planCode, source: p.source === "catalogue_modules" ? "catalogue_modules" : "enabled_modules",
        selected: strs(p.selected), pulledIn: strs(p.pulledIn), moduleIds: strs(p.moduleIds),
      };
    },
  });
}

export function getPlanQuote(planId: string): Promise<LoaderResult<PlanQuoteView | null>> {
  return fetchJson<unknown, PlanQuoteView | null>(`/api/v1/plans/${encodeURIComponent(planId)}/quote`, null, {
    telemetryKey: "plans.quote",
    mapResponse: (p) => {
      if (!isRec(p) || !isRec(p.totals) || !Array.isArray(p.lines)) return null;
      const t = p.totals;
      return {
        onDate: String(p.onDate ?? ""), billingCycle: String(p.billingCycle ?? ""),
        lines: p.lines.filter(isRec).map((l) => ({
          kind: l.kind === "addon" ? "addon" : "plan", key: String(l.key), gstRateBps: Number(l.gstRateBps ?? 0),
          netMinor: String(l.netMinor), gstMinor: String(l.gstMinor), grossMinor: String(l.grossMinor),
        })),
        totals: { netMinor: String(t.netMinor), gstMinor: String(t.gstMinor), grossMinor: String(t.grossMinor) },
      };
    },
  });
}
