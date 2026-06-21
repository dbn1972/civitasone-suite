import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { GrievanceRow } from "./schema.js";
import type { CitizenRequestSummary } from "@civitasone/types";

export async function getGrievance(tenantId: string, id: string): Promise<(GrievanceRow & { actions: Awaited<ReturnType<typeof repo.listActions>> }) | null> {
  const grievance = await cache.getOrLoad<GrievanceRow | null>(
    cache.makeKey(tenantId, "grievance", id),
    () => repo.findGrievanceById(id),
  );
  if (!grievance || grievance.tenantId !== tenantId) return null;
  const actions = await repo.listActions(id);
  return { ...grievance, actions };
}

export async function listGrievances(tenantId: string, citizenId: string): Promise<GrievanceRow[]> {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "grievances", citizenId),
    () => repo.listGrievancesByCitizen(tenantId, citizenId),
  );
  return rows ?? [];
}

function mapRequestStatus(status: string): CitizenRequestSummary["status"] {
  if (status === "registered") return "submitted";
  if (status === "assigned") return "under_review";
  if (status === "in_progress") return "in_progress";
  if (status === "resolved") return "resolved";
  if (status === "rejected") return "rejected";
  return "submitted";
}

export async function listRequests(tenantId: string, limit: number, offset: number): Promise<CitizenRequestSummary[]> {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "requests", `list:${limit}:${offset}`),
    () => repo.listGrievancesByTenant(tenantId, limit, offset),
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    requestNo: `GR-${row.id.slice(0, 8).toUpperCase()}`,
    serviceType: row.category,
    citizenName: row.citizenId,
    submittedAt: row.createdAt.toISOString(),
    status: mapRequestStatus(row.status),
  }));
}
