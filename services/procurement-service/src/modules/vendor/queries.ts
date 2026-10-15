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

export type VendorSummaryCounts = { total: number; empanelled: number; registered: number; blacklisted: number };

/**
 * GAP-PROCUREMENT-VENDORS-03: TRUE per-status counts over the whole tenant
 * directory (not the capped page the table receives), so the stat tiles stay
 * correct when the register is larger than the list cap.
 */
export async function vendorSummaryCounts(tenantId: string): Promise<VendorSummaryCounts> {
  const rows = await repo.countVendorsByType(tenantId);
  const by = new Map(rows.map((r) => [r.vendorType, r.n]));
  const empanelled = by.get("empanelled") ?? 0;
  const registered = by.get("registered") ?? 0;
  const blacklisted = by.get("blacklisted") ?? 0;
  return { total: empanelled + registered + blacklisted, empanelled, registered, blacklisted };
}

/**
 * GAP-PROCUREMENT-VENDORS-DETAIL-04: the vendor's latest empanelment validity
 * (YYYY-MM-DD) across its ACTIVE empanelments, or null when it has none / an
 * open-ended one. `lapsed` mirrors the PO gate (domain.isEmpanelmentLapsed).
 */
export async function empanelmentValidity(vendorId: string, tenantId: string, today: string): Promise<{ validTill: string | null; lapsed: boolean; hasEmpanelment: boolean }> {
  const rows = await repo.findEmpanelmentsByVendor(vendorId, tenantId);
  const active = rows.filter((r) => r.status === "active");
  const dated = active.map((r) => r.validUntil).filter((d): d is string => Boolean(d)).sort();
  const openEnded = active.some((r) => !r.validUntil);
  return {
    hasEmpanelment: rows.length > 0,
    validTill: openEnded ? null : (dated[dated.length - 1] ?? null),
    lapsed: rows.length > 0 && !active.some((r) => !r.validUntil || r.validUntil >= today),
  };
}

export async function listVendors(tenantId: string, limit: number, offset = 0, q?: string): Promise<{ data: Array<{ id: string; name: string; category: string; ratingDisplay: string; vendorType: "registered" | "empanelled" | "blacklisted"; blacklisted: boolean; gstin?: string; kycStatus: string; kycVerifiedAt?: string | null; email?: string; phone?: string; pan?: string; bankAccount?: string; ifsc?: string; contactPerson?: string; address?: string }> }> {
  const rows = await repo.listVendorsByTenant(tenantId, limit, offset, q);
  return {
    data: rows.map((v) => ({
      id: v.id,
      name: v.name,
      category: v.category ?? v.vendorType,
      ratingDisplay: v.mse ? "MSE ★★★★" : "—",
      kycStatus: v.kycStatus,
      vendorType: v.vendorType as "registered" | "empanelled" | "blacklisted",
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
