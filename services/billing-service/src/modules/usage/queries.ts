import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

export async function getUsage(tenantId: string, month?: string) {
  return cache.getOrLoad(cache.makeKey(tenantId, "usage", `${tenantId}:${month ?? "current"}`), () => repo.getMonthlySummary(tenantId, month));
}
