import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ProjectRow } from "./schema.js";

function minorToAmount(minor: bigint): number {
  return Number(minor) / 100;
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
  startDate: string;
  totalBudget: number;
  expenditure: number;
  completionPct: number;
  status: "planning" | "active" | "on_hold" | "completed" | "cancelled" | "delayed";
};

function mapProjectRow(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    projectCode: row.code,
    name: row.name,
    startDate: row.startDate?.toString() ?? row.createdAt.toISOString().slice(0, 10),
    totalBudget: minorToAmount(row.dprCostMinor),
    expenditure: minorToAmount(row.sanctionedMinor),
    completionPct: Number(row.physicalPct),
    status: mapProjectStatus(row.status),
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
  return rows.map(mapProjectRow);
}

export async function getProjectDetail(id: string, tenantId: string) {
  const row = await getProject(id, tenantId);
  if (!row) return null;
  const milestones = await repo.listMilestonesByProject(id);
  return {
    ...mapProjectRow(row),
    milestones: milestones.map((m) => ({
      id: m.id,
      title: m.name,
      dueDate: m.plannedDate.toString(),
      completedDate: m.actualDate?.toString(),
      status: (m.status === "completed" ? "completed" : m.status === "delayed" ? "delayed" : "pending") as "pending" | "completed" | "delayed",
    })),
    fundReleases: [],
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
