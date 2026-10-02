import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config.mjs";

type Rule = { source: string; destination: string; permanent: boolean };

// GAP-FINANCE-TRAVEL-01: finance/layout.tsx role-gates every /finance/* child before the page runs,
// so the page-level redirect() never fired for an employee with no finance role. A config redirect
// runs before any layout.
describe("/finance/travel config redirect", () => {
  it("permanently redirects /finance/travel to /hr/travel", async () => {
    const cfg = nextConfig as unknown as { redirects: () => Promise<unknown> };
    const rules = (await cfg.redirects()) as Rule[];
    expect(rules).toContainEqual({ source: "/finance/travel", destination: "/hr/travel", permanent: true });
  });
});
