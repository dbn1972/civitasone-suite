import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as portalRepo from "../portal/repo.js";
import type { ApplicationRow } from "./schema.js";

export async function getApplication(tenantId: string, id: string): Promise<(ApplicationRow & { history: Awaited<ReturnType<typeof repo.listStatusHistory>>; documents: Awaited<ReturnType<typeof repo.listDocuments>> }) | null> {
  const app = await cache.getOrLoad<ApplicationRow | null>(
    cache.makeKey(tenantId, "application", id),
    () => repo.findApplicationById(id),
  );
  if (!app || app.tenantId !== tenantId) return null;
  const [history, documents] = await Promise.all([
    repo.listStatusHistory(id),
    repo.listDocuments(id),
  ]);
  return { ...app, history, documents };
}

export async function listApplications(tenantId: string, citizenId: string): Promise<ApplicationRow[]> {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "applications", citizenId),
    () => repo.listApplicationsByCitizen(tenantId, citizenId),
  );
  return rows ?? [];
}

/** Officer-only: list applications across the whole tenant (no citizen scoping). */
export async function listAllApplications(tenantId: string): Promise<ApplicationRow[]> {
  return repo.listApplicationsByTenant(tenantId, 500);
}

function mapRequestStatus(status: string): "submitted" | "under_review" | "in_progress" | "resolved" | "rejected" {
  if (status === "under_review") return "under_review";
  if (status === "in_progress") return "in_progress";
  if (status === "resolved" || status === "approved") return "resolved";
  if (status === "rejected") return "rejected";
  return "submitted";
}

export async function listCitizenRequestSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "citizen_requests", `list:${limit}`),
    () => repo.listApplicationsByTenant(tenantId, limit),
  );
  const profileMap = new Map<string, { name: string; phone: string | null }>();
  for (const row of rows ?? []) {
    if (!profileMap.has(row.citizenId)) {
      const profile = await cache.getOrLoad(
        cache.makeKey(row.tenantId, "citizen_profile", row.citizenId),
        () => portalRepo.findProfileById(row.citizenId),
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
      requestNo: row.refNo,
      serviceType: row.serviceId,
      citizenName: p?.name ?? row.citizenId,
      ...(p?.phone ? { citizenPhone: `XXXXXX${p.phone.slice(-4)}` } : {}),
      submittedAt: new Date(row.submittedAt as unknown as string).toISOString(),
      ...(row.deadline ? { expectedResolutionDate: row.deadline.toString() } : {}),
      status: mapRequestStatus(row.status),
    };
  });
}
