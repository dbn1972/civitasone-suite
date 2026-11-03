import { describe, expect, it } from "vitest";
import {
  PURCHASE_ORDER_STATUSES,
  posListResponseSchema,
  purchaseOrderSchema,
  copilotTurnsListSchema,
  UserDetailSchema,
  RoleDetailSchema,
  AdminRoleSummaryListSchema,
} from "../src/web.js";

const po = (status: string) => ({ id: "po-1", poNo: "PO/2026/0001", vendor: "V", amountDisplay: "₹1", totalMinor: "100", orderDate: "2026-08-12", status });

describe("purchase order status (UAT-P1A-02)", () => {
  // Mirrors procurement-service migration 0008 (0008_competitive_procurement.sql), CHECK po.procurement_pos_status_check.
  const dbCheck = ["draft", "pending", "approved", "rejected", "gem_placed", "dispatched", "closed", "cancelled"];

  it("covers every status the PO CHECK constraint allows", () => {
    for (const s of dbCheck) expect(PURCHASE_ORDER_STATUSES).toContain(s);
    for (const s of dbCheck) expect(purchaseOrderSchema.safeParse(po(s)).success).toBe(true);
  });

  it("a closed PO no longer fails the whole list response", () => {
    const body = { data: [po("approved"), po("closed"), po("gem_placed"), po("cancelled")] };
    expect(posListResponseSchema.safeParse(body).success).toBe(true);
  });

  it("still rejects a status nothing writes", () => {
    expect(purchaseOrderSchema.safeParse(po("bogus")).success).toBe(false);
  });
});

describe("copilot citations with explicit nulls (UAT-P1A-03)", () => {
  it("parses url/score null and reads them as absent", () => {
    const parsed = copilotTurnsListSchema.safeParse({
      data: [{
        id: "5b0f3c1e-8a8d-4e0e-9a51-0d0c8a1e2f3a", userId: null, prompt: "q", response: null,
        sourceCitations: [{ id: null, title: "t", url: null, score: null }],
        model: null, tokens: null, latencyMs: null, createdAt: "2026-11-02T10:00:00Z", version: 1,
      }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.data[0]?.sourceCitations?.[0]).toEqual({ id: undefined, title: "t", url: undefined, score: undefined });
  });
});

describe("tenant-admin user / role detail (UAT-P1A-04)", () => {
  const user = { id: "u1", tenantId: "t", email: "a@b.in", name: "A", empCode: "E1", status: "active", mfaEnabled: false, version: 1 };

  it("accepts the identity-service user detail, which has no createdAt", () => {
    expect(UserDetailSchema.safeParse(user).success).toBe(true);
  });

  it("accepts every users.users status (identity 0027: active, suspended, locked, deactivated)", () => {
    for (const status of ["active", "suspended", "locked", "deactivated"]) {
      expect(UserDetailSchema.safeParse({ ...user, status }).success).toBe(true);
    }
    expect(UserDetailSchema.safeParse({ ...user, status: "bogus" }).success).toBe(false);
  });

  it("accepts the policy-service role list and detail, which have no createdAt", () => {
    const role = { id: "r1", tenantId: "t", name: "auditor", description: "Auditor", status: "active", version: 1 };
    expect(RoleDetailSchema.safeParse(role).success).toBe(true);
    expect(AdminRoleSummaryListSchema.safeParse([role, { ...role, id: "r2" }]).success).toBe(true);
  });
});
