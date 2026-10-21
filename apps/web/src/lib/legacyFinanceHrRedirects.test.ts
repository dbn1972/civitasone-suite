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

// GAP-FINANCE-MEDICAL-02: same root cause for the medical-claims bookmark. The page-level redirect() in
// finance/medical/page.tsx only runs after finance/layout.tsx's role gate, so employee / manager / HR users
// (outside FINANCE_ROLES) saw PermissionDenied instead of landing on /hr/medical.
describe("legacy /finance/medical redirect (next.config.mjs)", () => {
  it("permanently redirects /finance/medical to /hr/medical before any layout role gate", async () => {
    const r = await rules();
    expect(r).toContainEqual({ source: "/finance/medical", destination: "/hr/medical", permanent: true });
    // A single exact-path rule: it must not swallow other /finance/* routes.
    expect(r.filter((x) => x.source.startsWith("/finance/medical"))).toHaveLength(1);
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
