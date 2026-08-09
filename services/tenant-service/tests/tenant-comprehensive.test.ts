/**
 * Tenant Service — Comprehensive Domain + Validators Tests.
 *
 * Tests tenant lifecycle, provisioning validators, subscription lifecycle,
 * quota management, isolation tier, and MSME onboarding.
 *
 * Source: modules/tenant/domain.ts, modules/tenant/validators.ts,
 *         modules/subscriptions/validators.ts, modules/quotas/validators.ts
 */
import { describe, it, expect } from "vitest";
import { canTransition, assertTransition, DomainError } from "../src/modules/tenant/domain.js";
import { createTenantBody, updateTenantBody, suspendTenantBody, setIsolationBody, onboardTenantBody, updateQuotasBody, msmeOnboardBody } from "../src/modules/tenant/validators.js";
import { createSubscriptionBody, upgradeSubscriptionBody, cancelSubscriptionBody, renewSubscriptionBody, suspendSubscriptionBody, downgradeBody } from "../src/modules/subscriptions/validators.js";
import { quotaSetBody, quotaIncrementBody, quotaCheckBody } from "../src/modules/quotas/validators.js";

// ═══ TENANT LIFECYCLE (domain.ts) ═══

describe("tenant lifecycle — state machine (comprehensive)", () => {
  it("draft → active", () => expect(canTransition("draft" as any, "active" as any)).toBe(true));
  it("draft → archived", () => expect(canTransition("draft" as any, "archived" as any)).toBe(true));
  it("active → suspended", () => expect(canTransition("active" as any, "suspended" as any)).toBe(true));
  it("active → restricted", () => expect(canTransition("active" as any, "restricted" as any)).toBe(true));
  it("active → offboarding", () => expect(canTransition("active" as any, "offboarding" as any)).toBe(true));
  it("suspended → active (reinstate)", () => expect(canTransition("suspended" as any, "active" as any)).toBe(true));
  it("suspended → offboarding", () => expect(canTransition("suspended" as any, "offboarding" as any)).toBe(true));
  it("restricted → active", () => expect(canTransition("restricted" as any, "active" as any)).toBe(true));
  it("restricted → suspended", () => expect(canTransition("restricted" as any, "suspended" as any)).toBe(true));
  it("offboarding → archived", () => expect(canTransition("offboarding" as any, "archived" as any)).toBe(true));
  it("archived is terminal (no transitions out)", () => {
    for (const t of ["draft", "active", "suspended", "restricted", "offboarding"]) {
      expect(canTransition("archived" as any, t as any)).toBe(false);
    }
  });
  it("assertTransition throws DomainError", () => {
    expect(() => assertTransition("archived" as any, "active" as any)).toThrow(DomainError);
  });
});

// ═══ TENANT VALIDATORS ═══

describe("createTenantBody", () => {
  const valid = { name: "Test Org", domain: "test.gov.in", edition: "govt" as const, region: "ap-south-1", residency: "in" };
  it("accepts valid", () => expect(createTenantBody.safeParse(valid).success).toBe(true));
  it("rejects name < 2", () => expect(createTenantBody.safeParse({ ...valid, name: "X" }).success).toBe(false));
  it("rejects name > 200", () => expect(createTenantBody.safeParse({ ...valid, name: "x".repeat(201) }).success).toBe(false));
  it("rejects invalid domain", () => expect(createTenantBody.safeParse({ ...valid, domain: "has spaces!" }).success).toBe(false));
  it("rejects invalid edition", () => expect(createTenantBody.safeParse({ ...valid, edition: "enterprise" }).success).toBe(false));
  it("accepts all valid editions", () => {
    for (const ed of ["govt", "psu", "private", "ngo", "section8", "cooperative", "small_office"]) {
      expect(createTenantBody.safeParse({ ...valid, edition: ed }).success).toBe(true);
    }
  });
});

describe("updateTenantBody", () => {
  it("accepts name update", () => expect(updateTenantBody.safeParse({ name: "New Name" }).success).toBe(true));
  it("accepts settings update", () => expect(updateTenantBody.safeParse({ settings: { theme: "dark" } }).success).toBe(true));
  it("rejects empty body", () => expect(updateTenantBody.safeParse({}).success).toBe(false));
});

describe("suspendTenantBody", () => {
  it("accepts valid reason", () => expect(suspendTenantBody.safeParse({ reason: "Non-payment" }).success).toBe(true));
  it("rejects reason < 3", () => expect(suspendTenantBody.safeParse({ reason: "AB" }).success).toBe(false));
  it("rejects reason > 500", () => expect(suspendTenantBody.safeParse({ reason: "x".repeat(501) }).success).toBe(false));
});

describe("setIsolationBody", () => {
  it("accepts pool tier (no dbDsnRef needed)", () => expect(setIsolationBody.safeParse({ tier: "pool" }).success).toBe(true));
  it("accepts silo with dbDsnRef", () => expect(setIsolationBody.safeParse({ tier: "silo", dbDsnRef: "arn:aws:secretsmanager:..." }).success).toBe(true));
  it("rejects silo without dbDsnRef", () => expect(setIsolationBody.safeParse({ tier: "silo" }).success).toBe(false));
  it("rejects invalid tier", () => expect(setIsolationBody.safeParse({ tier: "shared" }).success).toBe(false));
});

describe("onboardTenantBody", () => {
  const valid = { name: "Org", domain: "org.gov.in", edition: "psu" as const, region: "in", residency: "in", adminEmail: "admin@org.gov.in", adminName: "Admin User" };
  it("accepts valid onboard", () => expect(onboardTenantBody.safeParse(valid).success).toBe(true));
  it("rejects invalid email", () => expect(onboardTenantBody.safeParse({ ...valid, adminEmail: "bad" }).success).toBe(false));
  it("rejects short admin name", () => expect(onboardTenantBody.safeParse({ ...valid, adminName: "A" }).success).toBe(false));
});

describe("updateQuotasBody", () => {
  it("accepts single quota", () => expect(updateQuotasBody.safeParse({ maxEmployees: 500 }).success).toBe(true));
  it("rejects empty (at least one field)", () => expect(updateQuotasBody.safeParse({}).success).toBe(false));
  it("rejects > 1,000,000 maxEmployees", () => expect(updateQuotasBody.safeParse({ maxEmployees: 1000001 }).success).toBe(false));
  it("rejects 0 maxUsers", () => expect(updateQuotasBody.safeParse({ maxUsers: 0 }).success).toBe(false));
});

describe("msmeOnboardBody — MSME/Udyam", () => {
  const valid = { udyamNumber: "UDYAM-AP-00-0001234", businessName: "Test MSME", ownerName: "Owner", email: "owner@msme.in", category: "micro" as const, sector: "services" as const };
  it("accepts valid Udyam", () => expect(msmeOnboardBody.safeParse(valid).success).toBe(true));
  it("rejects invalid Udyam format", () => expect(msmeOnboardBody.safeParse({ ...valid, udyamNumber: "UDYAM-123" }).success).toBe(false));
  it("rejects invalid category", () => expect(msmeOnboardBody.safeParse({ ...valid, category: "large" }).success).toBe(false));
  it("rejects invalid sector", () => expect(msmeOnboardBody.safeParse({ ...valid, sector: "agriculture" }).success).toBe(false));
  it("gstin must be exactly 15 chars", () => {
    expect(msmeOnboardBody.safeParse({ ...valid, gstin: "29ABCDE1234F1Z5" }).success).toBe(true);
    expect(msmeOnboardBody.safeParse({ ...valid, gstin: "29ABCDE" }).success).toBe(false);
  });
});

// ═══ SUBSCRIPTION VALIDATORS ═══

describe("createSubscriptionBody", () => {
  const valid = { tenantId: "10000000-aaaa-4000-8000-000000000001", planId: "20000000-bbbb-4000-8000-000000000001", startDate: "2026-07-01T00:00:00Z", currentPeriodStart: "2026-07-01T00:00:00Z", currentPeriodEnd: "2026-08-01T00:00:00Z" };
  it("accepts valid", () => expect(createSubscriptionBody.safeParse(valid).success).toBe(true));
  it("rejects non-UUID tenantId", () => expect(createSubscriptionBody.safeParse({ ...valid, tenantId: "bad" }).success).toBe(false));
  it("rejects non-datetime startDate", () => expect(createSubscriptionBody.safeParse({ ...valid, startDate: "2026-07-01" }).success).toBe(false));
});

describe("cancelSubscriptionBody", () => {
  it("accepts with reason", () => expect(cancelSubscriptionBody.safeParse({ reason: "Switching provider" }).success).toBe(true));
  it("rejects reason < 3", () => expect(cancelSubscriptionBody.safeParse({ reason: "No" }).success).toBe(false));
  it("defaults immediate to false", () => {
    const r = cancelSubscriptionBody.safeParse({ reason: "Budget cut" });
    expect(r.success && r.data.immediate).toBe(false);
  });
});

describe("downgradeBody — acknowledgement required", () => {
  it("requires acknowledgement=true", () => {
    expect(downgradeBody.safeParse({ targetPlanId: "10000000-aaaa-4000-8000-000000000001", acknowledgement: true }).success).toBe(true);
    expect(downgradeBody.safeParse({ targetPlanId: "10000000-aaaa-4000-8000-000000000001", acknowledgement: false }).success).toBe(false);
  });
});

// ═══ QUOTA VALIDATORS ═══

describe("quotaSetBody", () => {
  it("accepts valid", () => expect(quotaSetBody.safeParse({ tenantId: "10000000-aaaa-4000-8000-000000000001", resource: "users", limit: 1000 }).success).toBe(true));
  it("rejects invalid resource", () => expect(quotaSetBody.safeParse({ tenantId: "10000000-aaaa-4000-8000-000000000001", resource: "cpu", limit: 10 }).success).toBe(false));
  it("accepts all valid resources", () => {
    for (const r of ["users", "storage_gb", "api_calls_daily", "documents"]) {
      expect(quotaSetBody.safeParse({ tenantId: "10000000-aaaa-4000-8000-000000000001", resource: r, limit: 100 }).success).toBe(true);
    }
  });
  it("rejects limit > 100M", () => expect(quotaSetBody.safeParse({ tenantId: "10000000-aaaa-4000-8000-000000000001", resource: "users", limit: 100000001 }).success).toBe(false));
});

describe("quotaIncrementBody", () => {
  it("accepts positive delta", () => expect(quotaIncrementBody.safeParse({ tenantId: "10000000-aaaa-4000-8000-000000000001", resource: "users", delta: 10 }).success).toBe(true));
  it("accepts negative delta (decrement)", () => expect(quotaIncrementBody.safeParse({ tenantId: "10000000-aaaa-4000-8000-000000000001", resource: "storage_gb", delta: -5 }).success).toBe(true));
});

describe("quotaCheckBody", () => {
  it("defaults requestedAmount to 1", () => {
    const r = quotaCheckBody.safeParse({ tenantId: "10000000-aaaa-4000-8000-000000000001", resource: "api_calls_daily" });
    expect(r.success && r.data.requestedAmount).toBe(1);
  });
  it("rejects requestedAmount < 1", () => expect(quotaCheckBody.safeParse({ tenantId: "10000000-aaaa-4000-8000-000000000001", resource: "users", requestedAmount: 0 }).success).toBe(false));
});
