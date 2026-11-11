/**
 * SERVER-ONLY loaders for /hr/payroll/project-costing (S8 G7). Imports
 * apiClient (next/headers); client components import projectCostingShared.ts.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import {
  mapAllocations, mapByCostCenter, mapByProject, mapCostCenters, mapProjectIndex, mapSettings,
  type Allocation, type CostCenterCostRow, type CostCenterOption, type ProjectCostReport, type ProjectOption, type UnallocatedRow,
} from "./projectCostingShared";

export * from "./projectCostingShared";

const BASE = "/api/v1/payroll/project-costing";

export const getSettings = (): Promise<LoaderResult<{ enabled: boolean }>> =>
  fetchJson<unknown, { enabled: boolean }>(`${BASE}/settings`, { enabled: false }, { telemetryKey: "payroll.project-costing.settings", mapResponse: mapSettings });

export const getAllocations = (): Promise<LoaderResult<Allocation[]>> =>
  fetchJson<unknown, Allocation[]>(`${BASE}/allocations`, [], { telemetryKey: "payroll.project-costing.allocations", mapResponse: mapAllocations });

export const getByProject = (from: string, to: string): Promise<LoaderResult<ProjectCostReport>> =>
  fetchJson<unknown, ProjectCostReport>(`${BASE}/by-project?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { rows: [], minCohort: null }, {
    telemetryKey: "payroll.project-costing.by-project", mapResponse: mapByProject,
  });

export const getByCostCenter = (from: string, to: string): Promise<LoaderResult<{ data: CostCenterCostRow[]; unallocated: UnallocatedRow[] }>> =>
  fetchJson<unknown, { data: CostCenterCostRow[]; unallocated: UnallocatedRow[] }>(
    `${BASE}/by-cost-center?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { data: [], unallocated: [] },
    { telemetryKey: "payroll.project-costing.by-cost-center", mapResponse: mapByCostCenter });

/** project-service: project code / name / cost centre (no pay data in it). */
export const getProjectIndex = (): Promise<LoaderResult<ProjectOption[]>> =>
  fetchJson<unknown, ProjectOption[]>("/api/v1/projects/costing-index", [], { telemetryKey: "payroll.project-costing.projects", mapResponse: mapProjectIndex });

export const getCostCenters = (): Promise<LoaderResult<CostCenterOption[]>> =>
  fetchJson<unknown, CostCenterOption[]>("/api/v1/finance/cost-centers", [], { telemetryKey: "payroll.project-costing.cost-centers", mapResponse: mapCostCenters });
