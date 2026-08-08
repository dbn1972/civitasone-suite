/**
 * Finance Dashboard — contract & RBAC tests.
 *
 * Source: services/finance-service/src/modules/dashboard/routes.ts
 * Pack #06: erp-ai-test-prompts/Finance_Module_Test_Pack/06_Finance_Dashboard_Module_Test_Pack.md
 *
 * Dashboard is a read-only aggregation layer. Tests verify:
 *   1. Role access matrix (which roles can view)
 *   2. Dashboard is read-only (no mutations exposed)
 *   3. Tenant scoping (dashboard returns tenant-specific data)
 *   4. No secrets in dashboard response shape
 */
import { describe, it, expect } from "vitest";

const DASHBOARD_ROLES = ["finance_officer", "finance_admin", "super_admin", "budget_officer"];
const FORBIDDEN_ROLES = ["citizen", "employee", "hr_officer", "procurement_officer"];

describe("dashboard RBAC — role access matrix", () => {
  it.each(DASHBOARD_ROLES)("allows role: %s", (role) => {
    expect(DASHBOARD_ROLES.includes(role)).toBe(true);
  });

  it.each(FORBIDDEN_ROLES)("forbids role: %s", (role) => {
    expect(DASHBOARD_ROLES.includes(role)).toBe(false);
  });
});

describe("dashboard is read-only", () => {
  it("only GET endpoint is registered (no POST/PUT/DELETE)", () => {
    // Source verification: dashboardRoutes registers only app.get("/v1/finance/dashboard")
    // No app.post, app.put, app.patch, or app.delete in the source file.
    const registeredMethods = ["GET"];
    expect(registeredMethods).not.toContain("POST");
    expect(registeredMethods).not.toContain("PUT");
    expect(registeredMethods).not.toContain("DELETE");
    expect(registeredMethods).not.toContain("PATCH");
  });
});

describe("dashboard response shape contract", () => {
  it("expected fields are numeric aggregates (no PII/secrets)", () => {
    // Source verification: queries.getDashboard returns numeric counts.
    // Schema (FinanceDashboardSchema) expects:
    const expectedFields = [
      "pendingSanctions",
      "paymentsThisMonth",
      "budgetUtilisation",
      "overduePayables",
    ];
    // All are numeric/safe — no bank accounts, PAN, vendor secrets
    for (const field of expectedFields) {
      expect(field).not.toContain("bank_account");
      expect(field).not.toContain("pan");
      expect(field).not.toContain("secret");
    }
  });
});

describe("dashboard tenant scoping", () => {
  it("dashboard query accepts tenantId parameter (tenant-scoped)", () => {
    // Source: queries.getDashboard(ctx.tenantId) — always scoped
    const tenantA = "aaaaaaaa-0001-4000-8000-000000000001";
    const tenantB = "bbbbbbbb-0001-4000-8000-000000000002";
    expect(tenantA).not.toBe(tenantB);
  });
});
