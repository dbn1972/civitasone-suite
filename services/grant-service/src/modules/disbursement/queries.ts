import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { InstallmentRow } from "./schema.js";

export async function getInstallmentsByApplication(tenantId: string, applicationId: string): Promise<InstallmentRow[]> {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "installments", applicationId),
    () => repo.findInstallmentsByApplication(applicationId),
  );
  return rows ?? [];
}
