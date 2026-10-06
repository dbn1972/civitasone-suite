import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import nextConfig from "../../next.config.mjs";

// GAP-BILLING-HOME-02 / GAP-BILLING-LIST-01: /billing/list was an orphan
// duplicate of /billing/plans (same getBillingPlans loader, same title),
// unlinked from the hub/sidebar/navRouteManifest. The route folder is deleted
// and a permanent redirect preserves old bookmarks. These assertions fail on
// the old tree (where the redirect was absent and the route folder existed).
describe("billing list dead-route redirect (next.config.mjs)", () => {
  it("redirects /billing/list permanently to /billing/plans", async () => {
    const cfg = nextConfig as unknown as { redirects: () => Promise<unknown> };
    const rules = (await cfg.redirects()) as Array<{ source: string; destination: string; permanent: boolean }>;
    expect(rules).toContainEqual({ source: "/billing/list", destination: "/billing/plans", permanent: true });
  });

  it("the orphan /billing/list route folder no longer exists", () => {
    // vitest runs with apps/web as cwd (see vitest.config.ts root).
    const listDir = join(process.cwd(), "src/app/(app)/billing/list");
    expect(existsSync(listDir)).toBe(false);
  });
});
