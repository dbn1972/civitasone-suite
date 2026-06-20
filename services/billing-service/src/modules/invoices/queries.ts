import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

export async function listInvoices(tenantId: string) {
  return cache.getOrLoad(cache.makeKey(tenantId, "invoices", tenantId), () => repo.listByTenant(tenantId));
}
