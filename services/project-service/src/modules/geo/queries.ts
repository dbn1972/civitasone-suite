import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

export async function getGeoTags(projectId: string, tenantId: string) {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "geo", projectId),
    () => repo.listGeoTagsByProject(projectId, tenantId)
  );
}
