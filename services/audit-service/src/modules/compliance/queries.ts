import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

export async function listPending(tenantId: string, status = "pending") {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "pending_register", status),
    () => repo.listPendingRegister(tenantId, status),
  );
}
