import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as portalRepo from "../portal/repo.js";
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

/** Officer-only: list grievances across the whole tenant (no citizen scoping). */
export async function listAllGrievances(tenantId: string): Promise<GrievanceRow[]> {
  return repo.listGrievancesByTenant(tenantId, 500, 0);
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
  const profileMap = new Map<string, { name: string; phone: string | null }>();
  for (const row of rows ?? []) {
    if (!profileMap.has(row.citizenId)) {
      const profile = await cache.getOrLoad(
        cache.makeKey(tenantId, "citizen_profile", row.citizenId),
        () => portalRepo.findProfileById(row.citizenId, tenantId),
      );
      profileMap.set(row.citizenId, {
        name: profile?.name ?? row.citizenId,
        phone: profile?.mobile ?? null,
      });
    }
  }
  return (rows ?? []).map((row) => {
    const p = profileMap.get(row.citizenId);
    return {
      id: row.id,
      requestNo: `GR-${row.id.slice(0, 8).toUpperCase()}`,
      serviceType: row.category,
      citizenName: p?.name ?? row.citizenId,
      ...(p?.phone ? { citizenPhone: `XXXXXX${p.phone.slice(-4)}` } : {}),
      submittedAt: new Date(row.createdAt as unknown as string).toISOString(),
      status: mapRequestStatus(row.status),
    };
  });
}
