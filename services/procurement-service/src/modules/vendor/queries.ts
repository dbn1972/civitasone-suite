import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { VendorRow } from "./schema.js";

/**
 * Mask a bank account number for read responses: only the last four characters
 * survive (a number shorter than four is masked in full). The full number is
 * write-only through this API; payments read it server-side from the row.
 */
export function maskAccountNumber(value: string): string {
  const v = value.trim();
  if (v.length < 4) return "*".repeat(Math.max(v.length, 4));
  return `${"*".repeat(v.length - 4)}${v.slice(-4)}`;
}

/** Vendor row as returned to clients: bank account number masked. */
export function presentVendor<T extends { bankAccount?: string | null }>(v: T): T {
  return v.bankAccount ? { ...v, bankAccount: maskAccountNumber(v.bankAccount) } : v;
}

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

/** GAP2-PROCUREMENT-EMPANELMENT-02 / GAPLIST-03: true total empanelment count for meta.total. */
export async function countEmpanelments(tenantId: string): Promise<number> {
  return repo.countEmpanelmentsByTenant(tenantId);
}

export async function getVendor(id: string, tenantId: string): Promise<VendorRow | null> {
  return cache.getOrLoad<VendorRow>(
    cache.makeKey(tenantId, "vendor", id),
    () => repo.findVendorById(id, tenantId)
  );
}

export async function listVendors(tenantId: string, limit: number, offset = 0): Promise<{ data: Array<{ id: string; name: string; category: string; ratingDisplay: string; blacklisted: boolean; gstin?: string; kycStatus: string; kycVerifiedAt?: string | null; email?: string; phone?: string; pan?: string; bankAccount?: string; ifsc?: string; contactPerson?: string; address?: string }> }> {
  const rows = await repo.listVendorsByTenant(tenantId, limit, offset);
  return {
    data: rows.map((v) => ({
      id: v.id,
      name: v.name,
      category: v.category ?? v.vendorType,
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
      ...(v.bankAccount ? { bankAccount: maskAccountNumber(v.bankAccount) } : {}),
      ...(v.contactPerson ? { contactPerson: v.contactPerson } : {}),
      ...(v.address ? { address: v.address } : {}),
      ...(v.ifsc ? { ifsc: v.ifsc } : {}),
    })),
  };
}
