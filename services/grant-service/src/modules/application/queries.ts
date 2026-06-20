import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ApplicationRow } from "./schema.js";

export async function getApplication(tenantId: string, id: string): Promise<ApplicationRow | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "application", id),
    () => repo.findApplicationById(id)
  );
}
