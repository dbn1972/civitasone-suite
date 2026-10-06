import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config.mjs";

type Rule = { source: string; destination: string; permanent: boolean };
async function rules(): Promise<Rule[]> {
  const cfg = nextConfig as unknown as { redirects: () => Promise<unknown> };
  return (await cfg.redirects()) as Rule[];
}

// GAP-STOCK batch 2 (fix/gap-stock): the audit snapshot (~2026-09-29) described
// bugs on the legacy /stock/ledger, /stock/list and /stock/ledger/new pages.
// Since that snapshot the whole /stock/* tree was superseded by the canonical
// /inventory/* routes and next.config.mjs now PERMANENTLY redirects every
// /stock/* request to its /inventory/* equivalent, so none of those legacy
// pages are reachable by a user: the server answers with a 308 before the page
// renders. This test pins that contract -- it is the fact that reclassifies the
// whole batch (every behaviour it asked for lives on, and is tested on, the
// reachable /inventory/* routes). It fails on the pre-migration config (no
// stock redirects) and passes now.
describe("legacy stock -> inventory redirects (next.config.mjs)", () => {
  it("permanently redirects the specific legacy stock routes to their inventory homes", async () => {
    const r = await rules();
    // /stock/ledger -> /inventory/reconcile (the Stock Movements Summary that
    // replaced the old ledger page; GAP-STOCK-LEDGER-01..08 live there).
    expect(r).toContainEqual({ source: "/stock/ledger", destination: "/inventory/reconcile", permanent: true });
    // /stock/list -> /inventory/list (GAP-STOCK-LIST-01..07 live there).
    expect(r).toContainEqual({ source: "/stock/list", destination: "/inventory/list", permanent: true });
    expect(r).toContainEqual({ source: "/stock", destination: "/inventory", permanent: true });
    expect(r).toContainEqual({ source: "/stock/dashboard", destination: "/inventory", permanent: true });
  });

  it("has a catch-all /stock/:path* redirect that covers deeper legacy paths", async () => {
    const r = await rules();
    // This covers /stock/ledger/new -> /inventory/ledger/new (the canonical
    // New Stock Entry form where GAP-STOCK-LEDGER-NEW-01..09 live) and every
    // other /stock/* child, so no legacy stock page is reachable.
    expect(r).toContainEqual({ source: "/stock/:path*", destination: "/inventory/:path*", permanent: true });
  });

  it("orders the specific stock redirects before the /stock/:path* catch-all (first match wins)", async () => {
    const r = await rules();
    const catchAll = r.findIndex((x) => x.source === "/stock/:path*");
    const specific = ["/stock", "/stock/list", "/stock/ledger", "/stock/dashboard"].map((s) =>
      r.findIndex((x) => x.source === s),
    );
    expect(catchAll).toBeGreaterThanOrEqual(0);
    for (const i of specific) {
      expect(i).toBeGreaterThanOrEqual(0);
      // Next.js evaluates redirects top-down; a specific rule must precede the
      // wildcard or the wildcard would shadow it and send /stock/ledger to
      // /inventory/ledger (a 404) instead of /inventory/reconcile.
      expect(i).toBeLessThan(catchAll);
    }
  });
});
