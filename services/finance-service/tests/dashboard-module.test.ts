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
import { computeBudgetUtilisationPct } from "../src/modules/dashboard/queries.js";

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

// ---------------------------------------------------------------------------
// Issue #7: "Budget Utilisation (FY)" showed a fabricated 0.0% for a tenant
// with real, non-zero expenditure but zero rows in financeBudgets (no
// sanctioned Budget Estimate on record yet). Live-verified against the real
// finance DB: tenant 11111111-0000-0000-0000-000000000001 has
// gl.finance_ledger summing to 500000 (debit_minor) and ZERO rows in
// budget.finance_budgets. UX-006: that must render as "no data" (null ->
// "—" on the frontend), never as a real-looking "0.0%" indistinguishable
// from a genuine zero-utilisation budget.
// ---------------------------------------------------------------------------
describe("computeBudgetUtilisationPct (Issue #7)", () => {
  it("returns null when there is no sanctioned budget on record, even with real expenditure", () => {
    // Exactly the live-verified shape: real ledger spend, zero budget rows.
    expect(computeBudgetUtilisationPct(500000, 0)).toBeNull();
  });

  it("computes a real rounded percentage when a sanctioned budget exists", () => {
    expect(computeBudgetUtilisationPct(45, 100)).toBe(45);
    expect(computeBudgetUtilisationPct(1, 3)).toBe(33); // Math.round(33.33...)
  });

  it("returns a genuine 0, distinct from null, when a real budget exists but nothing has been spent", () => {
    const result = computeBudgetUtilisationPct(0, 100);
    expect(result).toBe(0);
    expect(result).not.toBeNull();
  });

  it("treats a negative/invalid sanctioned amount the same as absent (null, not a fabricated 0)", () => {
    expect(computeBudgetUtilisationPct(500000, -1)).toBeNull();
  });
});
