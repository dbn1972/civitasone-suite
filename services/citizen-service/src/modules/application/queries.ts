import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
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
  return (rows ?? []).map((row) => ({
    id: row.id,
    requestNo: row.refNo,
    serviceType: row.serviceId,
    citizenName: row.citizenId,
    submittedAt: row.submittedAt.toISOString(),
    expectedResolutionDate: row.deadline?.toString(),
    status: mapRequestStatus(row.status),
  }));
}
