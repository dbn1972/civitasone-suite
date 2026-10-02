import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config.mjs";
import { HR_ROLES } from "@/lib/auth/workRoles";

type Rule = { source: string; destination: string; permanent: boolean };
async function rules(): Promise<Rule[]> {
  const cfg = nextConfig as unknown as { redirects: () => Promise<unknown> };
  return (await cfg.redirects()) as Rule[];
}

// GAP-FINANCE-EXPENSES-02 / GAP-FINANCE-LOANS-02: the page-level redirect() files never ran for a
// finance-only role (finance/layout.tsx gates first, and its role list differs from the HR one), and
// nothing recorded hits on them. A config redirect runs before any layout and keeps old bookmarks working.
describe("legacy finance -> HR redirects (next.config.mjs)", () => {
  it("redirects /finance/expenses and /finance/loans permanently to the HR modules", async () => {
    const r = await rules();
    expect(r).toContainEqual({ source: "/finance/expenses", destination: "/hr/expenses", permanent: true });
    expect(r).toContainEqual({ source: "/finance/loans", destination: "/hr/loans", permanent: true });
  });
});

// GAP-FINANCE-EXPENSES-01 / GAP-FINANCE-LOANS-01: the HR layout must admit the finance roles that
// hrms-service's claims and loans routes accept, so the redirect target is not a permission wall.
describe("HR layout admits the finance roles the redirect targets serve", () => {
  it("HR_ROLES includes finance_officer and finance_admin", () => {
    expect(HR_ROLES).toContain("finance_officer");
    expect(HR_ROLES).toContain("finance_admin");
  });
});
