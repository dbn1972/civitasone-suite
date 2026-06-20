import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

export async function getUcStatements(tenantId: string, applicationId: string) {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "uc", applicationId),
    () => repo.listUcByApplication(applicationId),
  );
}
