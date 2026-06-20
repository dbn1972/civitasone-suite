import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

export async function getSubscription(tenantId: string) {
  return cache.getOrLoad(cache.makeKey(tenantId, "subscription", tenantId), () => repo.findByTenant(tenantId));
}
