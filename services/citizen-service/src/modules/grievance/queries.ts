import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { GrievanceRow } from "./schema.js";

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
