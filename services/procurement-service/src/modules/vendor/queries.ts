import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { VendorRow } from "./schema.js";

export type EmpanelmentSummary = {
  id: string;
  vendorName: string;
  category: string;
  validUntil: string;
  rating: number;
  status: string;
};

/** Empanelment register (gap/routes.ts real-data lift) — vendor name + rating join. */
export async function listEmpanelments(tenantId: string, limit: number, offset: number): Promise<EmpanelmentSummary[]> {
  const rows = await repo.listEmpanelmentsByTenant(tenantId, limit, offset);
  return rows.map((r) => ({
    id: r.id,
    vendorName: r.vendorName,
    category: r.category,
    validUntil: r.validUntil ?? "",
    rating: r.overallRating ?? 0,
    status: r.status,
  }));
}

export async function getVendor(id: string, tenantId: string): Promise<VendorRow | null> {
  return cache.getOrLoad<VendorRow>(
    cache.makeKey(tenantId, "vendor", id),
    () => repo.findVendorById(id, tenantId)
  );
}

export async function listVendors(tenantId: string, limit: number, offset = 0): Promise<{ data: Array<{ id: string; name: string; category: string; ratingDisplay: string; blacklisted: boolean; gstin?: string; kycStatus: string; kycVerifiedAt?: string | null; email?: string; phone?: string; pan?: string; bankAccount?: string; ifsc?: string }> }> {
  const rows = await repo.listVendorsByTenant(tenantId, limit, offset);
  return {
    data: rows.map((v) => ({
      id: v.id,
      name: v.name,
      category: v.vendorType,
      ratingDisplay: v.mse ? "MSE ★★★★" : "—",
      kycStatus: v.kycStatus,
      // GAP-PROCUREMENT-RFQ-NEW-02: surface the blacklist state so the RFQ
      // invite list can disable + badge a blacklisted vendor. The POST /rfqs
      // route is the real control (it rejects a blacklisted vendor with 422,
      // incl. active tenant/central debarment); this is the UI affordance so
      // the officer never selects one and hits that error.
      blacklisted: v.vendorType === "blacklisted",
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
