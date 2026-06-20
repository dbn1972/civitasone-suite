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
