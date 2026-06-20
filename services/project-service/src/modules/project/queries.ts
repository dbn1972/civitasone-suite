import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ProjectRow } from "./schema.js";

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
