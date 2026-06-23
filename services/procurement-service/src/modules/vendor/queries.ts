import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { VendorRow } from "./schema.js";

export async function getVendor(id: string, tenantId: string): Promise<VendorRow | null> {
  return cache.getOrLoad<VendorRow>(
    cache.makeKey(tenantId, "vendor", id),
    () => repo.findVendorById(id)
  );
}

export async function listVendors(tenantId: string, limit: number, offset = 0): Promise<{ data: Array<{ id: string; name: string; category: string; ratingDisplay: string; gstin?: string; kycStatus: string; kycVerifiedAt?: string | null; email?: string; phone?: string; pan?: string; bankAccount?: string; ifsc?: string }> }> {
  const rows = await repo.listVendorsByTenant(tenantId, limit, offset);
  return {
    data: rows.map((v) => ({
      id: v.id,
      name: v.name,
      category: v.vendorType,
      ratingDisplay: v.mse ? "MSE ★★★★" : "—",
      kycStatus: v.kycStatus,
      kycVerifiedAt: v.kycVerifiedAt ? v.kycVerifiedAt.toISOString() : null,
      ...(v.gstin ? { gstin: v.gstin } : {}),
      ...(v.email ? { email: v.email } : {}),
      ...(v.phone ? { phone: v.phone } : {}),
      ...(v.pan ? { pan: v.pan } : {}),
      ...(v.bankAccount ? { bankAccount: v.bankAccount } : {}),
      ...(v.ifsc ? { ifsc: v.ifsc } : {}),
    })),
  };
}
