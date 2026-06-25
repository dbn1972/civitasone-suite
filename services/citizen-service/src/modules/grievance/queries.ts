import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as portalRepo from "../portal/repo.js";
import type { GrievanceRow } from "./schema.js";
import type { CitizenRequestSummary } from "@civitasone/types";

/** Cache JSON-roundtrips timestamp columns to ISO strings; coerce safely. */
function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/**
 * Re-coerce the cached row's timestamps so a cache HIT (JSON strings) and a
 * cache MISS (Date objects) return identical shapes to the API. Without this,
 * `createdAt`/`updatedAt` leak as Date on a miss and string on a hit.
 * (P1-3/P1-4 read-model consistency.)
 */
function normalizeGrievanceDates<T extends GrievanceRow>(g: T): T {
  return {
    ...g,
    createdAt: toIso(g.createdAt) as unknown as T["createdAt"],
    updatedAt: toIso(g.updatedAt) as unknown as T["updatedAt"],
  };
}

export async function getGrievance(tenantId: string, id: string): Promise<(GrievanceRow & { actions: Awaited<ReturnType<typeof repo.listActions>> }) | null> {
  const grievance = await cache.getOrLoad<GrievanceRow | null>(
    cache.makeKey(tenantId, "grievance", id),
    () => repo.findGrievanceById(id),
  );
  if (!grievance || grievance.tenantId !== tenantId) return null;
  const actions = await repo.listActions(id);
  return { ...normalizeGrievanceDates(grievance), actions };
}

export async function listGrievances(tenantId: string, citizenId: string): Promise<GrievanceRow[]> {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "grievances", citizenId),
    () => repo.listGrievancesByCitizen(tenantId, citizenId),
  );
  return (rows ?? []).map(normalizeGrievanceDates);
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
      submittedAt: toIso(row.createdAt as unknown as string),
      status: mapRequestStatus(row.status),
    };
  });
}
