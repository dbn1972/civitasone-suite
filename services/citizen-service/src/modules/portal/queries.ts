import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ServiceRow } from "./schema.js";

export async function getService(tenantId: string, id: string): Promise<ServiceRow | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "service", id),
    () => repo.findServiceById(id, tenantId),
  );
}

export async function listServices(tenantId: string): Promise<ServiceRow[]> {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "services", "all"),
    () => repo.listServices(tenantId),
  );
  return rows ?? [];
}
