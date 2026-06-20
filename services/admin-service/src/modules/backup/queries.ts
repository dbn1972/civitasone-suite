import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

export async function getBackupRuns(tenantId: string) {
  return cache.getOrLoad(cache.makeKey(tenantId, "backup_runs", tenantId), () => repo.listRuns(tenantId));
}
