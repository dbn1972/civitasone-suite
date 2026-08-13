import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

export async function listPending(tenantId: string, status = "pending") {
  try {
    return await cache.getOrLoad(
      cache.makeKey(tenantId, "pending_register", status),
      () => repo.listPendingRegister(tenantId, status),
    );
  } catch {
    // Cache unavailable (e.g. Redis down in staging) — fall through to DB directly.
    return repo.listPendingRegister(tenantId, status);
  }
}
