/**
 * SERVER-ONLY loaders for /hr/payroll/costing. Imports apiClient (which uses
 * next/headers), so client components must import costingShared.ts instead.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { mapCostCenters, mapReport, mapRules, type CostCenterOption, type CostingRule, type ReportRow } from "./costingShared";

export * from "./costingShared";

export async function getRules(): Promise<LoaderResult<CostingRule[]>> {
  return fetchJson<unknown, CostingRule[]>("/api/v1/payroll/costing/rules", [], {
    telemetryKey: "payroll.costing.rules",
    mapResponse: mapRules,
  });
}

export async function getReport(period: string): Promise<LoaderResult<ReportRow[]>> {
  return fetchJson<unknown, ReportRow[]>(`/api/v1/payroll/costing/report?period=${encodeURIComponent(period)}`, [], {
    telemetryKey: "payroll.costing.report",
    mapResponse: mapReport,
  });
}

/** finance-service org-structure master (GET /v1/finance/cost-centers). */
export async function getCostCenters(): Promise<LoaderResult<CostCenterOption[]>> {
  return fetchJson<unknown, CostCenterOption[]>("/api/v1/finance/cost-centers", [], {
    telemetryKey: "payroll.costing.cost-centers",
    mapResponse: mapCostCenters,
  });
}
