import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { VendorRow } from "./schema.js";

export async function getVendor(id: string, tenantId: string): Promise<VendorRow | null> {
  return cache.getOrLoad<VendorRow>(
    cache.makeKey(tenantId, "vendor", id),
    () => repo.findVendorById(id)
  );
}

export async function listVendors(tenantId: string, limit: number): Promise<{ data: Array<{ name: string; category: string; ratingDisplay: string }> }> {
  const rows = await repo.listVendorsByTenant(tenantId, limit);
  return { data: rows.map((v) => ({ name: v.name, category: v.vendorType, ratingDisplay: v.mse ? "MSE ★★★★" : "—" })) };
}
