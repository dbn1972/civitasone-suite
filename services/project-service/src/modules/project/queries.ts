import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as schemeRepo from "../scheme/repo.js";
import type { ProjectRow } from "./schema.js";

function minorToAmount(minor: bigint): number {
  return Number(minor) / 100;
}

function computeExpenditure(row: ProjectRow): number {
  const sanctioned = Number(row.sanctionedMinor);
  const pct = Number(row.financialPct);
  return Math.round((sanctioned * pct) / 100) / 100;
}

function mapProjectStatus(status: string): ProjectSummary["status"] {
  if (status === "active") return "active";
  if (status === "on_hold") return "on_hold";
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "delayed") return "delayed";
  return "planning";
}

type ProjectSummary = {
  id: string;
  projectCode: string;
  name: string;
  scheme?: string;
  department?: string;
  startDate: string;
  expectedEndDate?: string;
  totalBudget: number;
  expenditure: number;
  completionPct: number;
  status: "planning" | "active" | "on_hold" | "completed" | "cancelled" | "delayed";
};

function mapProjectRow(row: ProjectRow, schemeName?: string): ProjectSummary {
  const status = row.rag === "red" && row.status === "active"
    ? "delayed"
    : mapProjectStatus(row.status);
  return {
    id: row.id,
    projectCode: row.code,
    name: row.name,
    ...(schemeName ? { scheme: schemeName } : {}),
    ...(row.agencyRef ? { department: row.agencyRef } : {}),
    startDate: row.startDate?.toString() ?? new Date(row.createdAt as unknown as string).toISOString().slice(0, 10),
    ...(row.endDate ? { expectedEndDate: row.endDate.toString() } : {}),
    totalBudget: minorToAmount(row.dprCostMinor),
    expenditure: computeExpenditure(row),
    completionPct: Number(row.physicalPct),
    status,
  };
}

export async function getProject(id: string, tenantId: string): Promise<ProjectRow | null> {
  return cache.getOrLoad<ProjectRow>(
    cache.makeKey(tenantId, "project", id),
    () => repo.findProjectById(id)
  );
}

export async function listProjects(
  tenantId: string,
  status: string | undefined,
  page: number,
  limit: number
): Promise<ProjectRow[]> {
  const offset = (page - 1) * limit;
  const result = await cache.getOrLoad<ProjectRow[]>(
    cache.makeKey(tenantId, "project", `list:${status ?? "all"}:${page}:${limit}`),
    () => repo.listProjects(tenantId, status, limit, offset)
  );
  return result ?? [];
}

export async function listProjectSummaries(tenantId: string, limit: number): Promise<ProjectSummary[]> {
  const rows = await listProjects(tenantId, undefined, 1, limit);
  const summaries: ProjectSummary[] = [];
  for (const row of rows) {
    const scheme = row.schemeId ? await schemeRepo.findSchemeById(row.schemeId) : null;
    summaries.push(mapProjectRow(row, scheme?.name));
  }
  return summaries;
}

export async function getProjectDetail(id: string, tenantId: string) {
  const row = await getProject(id, tenantId);
  if (!row) return null;
  const [milestones, scheme, fundReleaseRows] = await Promise.all([
    repo.listMilestonesByProject(id),
    row.schemeId ? schemeRepo.findSchemeById(row.schemeId) : Promise.resolve(null),
    row.schemeId ? schemeRepo.listFundReleasesByScheme(row.schemeId) : Promise.resolve([]),
  ]);
  return {
    ...mapProjectRow(row, scheme?.name),
    milestones: milestones.map((m) => ({
      id: m.id,
      title: m.name,
      dueDate: m.plannedDate.toString(),
      completedDate: m.actualDate?.toString(),
      status: (m.status === "completed" ? "completed" : m.status === "delayed" ? "delayed" : "pending") as "pending" | "completed" | "delayed",
    })),
    fundReleases: fundReleaseRows
      .filter((fr) => fr.status === "disbursed" || fr.status === "utilised")
      .map((fr) => ({
        id: fr.id,
        releaseDate: (fr.disbursedAt ?? fr.sanctionedAt ?? fr.createdAt).toISOString().slice(0, 10),
        amount: minorToAmount(fr.amountMinor),
        remarks: fr.pfmsRef ?? fr.releaseNo,
      })),
  };
}

export async function listMilestoneSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "milestones", `list:${limit}`),
    () => repo.listMilestonesByTenant(tenantId, limit),
  );
  const summaries = [];
  for (const row of rows ?? []) {
    const project = await repo.findProjectById(row.projectId);
    summaries.push({
      id: row.id,
      projectId: row.projectId,
      projectName: project?.name ?? row.projectId,
      title: row.name,
      dueDate: row.plannedDate.toString(),
      completedDate: row.actualDate?.toString(),
      status: (row.status === "completed" ? "completed" : row.status === "delayed" ? "delayed" : "pending") as "pending" | "completed" | "delayed",
    });
  }
  return summaries;
}
