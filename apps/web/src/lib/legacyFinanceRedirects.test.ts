import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config.mjs";

// GAP-FINANCE-ADVANCES-01 / BENEFITS-01 / BENEFITS-02: finance/layout.tsx role-gates
// every /finance/* page before it runs, so the old redirect() pages never fired for
// employees. Config redirects run first and Next keeps the query string.
describe("legacy finance redirects (next.config.mjs)", () => {
  it("redirects /finance/advances and /finance/benefits permanently to the HR modules", async () => {
    const cfg = nextConfig as unknown as { redirects: () => Promise<unknown> };
    const rules = (await cfg.redirects()) as Array<{ source: string; destination: string; permanent: boolean }>;
    expect(rules).toContainEqual({ source: "/finance/advances", destination: "/hr/advances", permanent: true });
    expect(rules).toContainEqual({ source: "/finance/benefits", destination: "/hr/benefits", permanent: true });
    // the real finance advances page is untouched
    expect(rules.some((r) => r.source.startsWith("/finance/expenditure"))).toBe(false);
  });
});
