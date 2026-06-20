import { cache } from "../../shared/infra.js";
import { TASK_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";

export async function getTask(id: string, tenantId: string) {
  return cache.getOrLoad(cache.makeKey(tenantId, TASK_RESOURCE, id), () => repo.findById(id, tenantId));
}
