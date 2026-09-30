/**
 * route-existence.contract.test.ts — GAP-HR-SF-18
 *
 * Runs scripts/contract/route-existence.mjs (static analyzer, no running
 * services) and asserts that every internal navigation target the web app
 * can construct — a literal `href`, a `<DataTable rowLinkPrefix>` drill-
 * through, a `router.push`/`router.replace`/`redirect` call, or a helper
 * function that maps a type/status/key to a URL and returns it (e.g.
 * `buildApprovalLink`) — resolves to a real Next.js route.
 *
 * This protects the Phase 4 per-page remediation work (see the campaign
 * plan) from a dead link landing unnoticed while dozens of pages are being
 * touched in parallel: a typo'd path, a renamed route, or a mapping table
 * that was never updated when a route moved all produce the exact same
 * symptom (a 404 on click) that no loader-chain or role-matrix check would
 * ever catch, because these are plain navigation, not data fetches or auth.
 *
 * This is NOT a fix-everything gate, same spirit as hr-role-matrix's own
 * allowlist: 3 currently-existing dead links this analyzer found are
 * genuinely missing destination pages (a product/feature gap, not a link
 * typo) and are named, with a reason, in KNOWN_EXCEPTIONS below -- this
 * test passes today BECAUSE of that ledger, not despite it. What it
 * protects against is a *new*, previously-unknown dead link landing
 * unnoticed.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { routeSegmentType, toSegments, segsMatchRoute, isRoutePath } from "../../scripts/contract/route-existence.mjs";

const ROOT = join(import.meta.dirname, "../..");
const SCRIPT = join(ROOT, "scripts/contract/route-existence.mjs");
const ARTEFACT = join(ROOT, "scripts/contract/route-existence.json");

type LinkRow = {
  file: string;
  line: number;
  kind: "href" | "rowLinkPrefix" | "navigate" | "helperReturn";
  fn?: string;
  target: string;
  resolved: string;
  ok: boolean;
};

type Report = {
  generatedAt: string;
  counts: {
    realRoutes: number;
    totalLinks: number;
    byKind: Record<string, number>;
    dead: number;
  };
  links: LinkRow[];
  dead: LinkRow[];
};

let report: Report;

beforeAll(() => {
  // Re-run the analyzer so this test always reflects current source, not a
  // stale committed snapshot.
  execSync(`node ${SCRIPT}`, { stdio: "pipe", cwd: ROOT });
  report = JSON.parse(readFileSync(ARTEFACT, "utf8")) as Report;
}, 60_000);

describe("route-existence contract", () => {
  it("analyzer actually ran and found a healthy number of routes and link candidates", () => {
    // Guards against a broken analyzer silently reporting nothing (which
    // would make every assertion below vacuously pass). Only a floor, not
    // pinned, so ordinary route/link additions don't need this test touched.
    expect(report.counts.realRoutes).toBeGreaterThan(300);
    expect(report.counts.totalLinks).toBeGreaterThan(300);
    expect(report.counts.byKind.href ?? 0).toBeGreaterThan(0);
    expect(report.counts.byKind.rowLinkPrefix ?? 0).toBeGreaterThan(0);
    expect(report.counts.byKind.helperReturn ?? 0).toBeGreaterThan(0);
  });

  // A narrow, ID-tagged, tracked ledger -- not a blanket carve-out, same
  // pattern as screens.contract.test.ts's KNOWN_EXCEPTIONS and
  // crm-link-integrity's clean-by-default bar. Each entry is a REAL,
  // currently-existing dead link this analyzer correctly found, whose fix
  // is a page/feature build (there is no existing correct route to point
  // at instead), not a link correction -- out of scope for a detector PR
  // to build. Every OTHER dead link this analyzer found while it was being
  // written (a wrong-prefix bug in three places, and two wrong mapped
  // paths in buildApprovalLink, including the finance_bill one that
  // motivated this whole analyzer) was a trivial route-string correction,
  // fixed directly in this same PR instead of listed here. Do not add an
  // entry here to make a NEW dead link disappear without finding out why
  // it exists first.
  const KNOWN_EXCEPTIONS: Array<{ id: string; file: string; target: string; reason: string }> = [
    {
      id: "GAP-HR-SF18-001",
      file: "apps/web/src/app/(app)/analytics/ml-insights/anomalies/page.tsx",
      target: "/finance/anomalies/",
      reason:
        "ML-insights transaction-anomaly drill-through has no destination: unlike its sibling ml-insights domains (crm/leads, inventory, projects, subscriptions, tickets), no finance \"anomalies\" detail page exists anywhere under apps/web/src/app/(app)/finance. Building one is a product feature, not a link correction.",
    },
    {
      id: "GAP-HR-SF18-002",
      file: "apps/web/src/app/(app)/analytics/ml-insights/subscriptions/page.tsx",
      target: "/billing/subscriptions/",
      reason:
        "billing/subscriptions/page.tsx (the list) exists but no billing/subscriptions/[id] detail page was ever built -- contrast billing/plans/[id] and billing/invoices/[id], which both exist. A missing feature, not a link correction.",
    },
    {
      id: "GAP-HR-SF18-003",
      file: "apps/web/src/app/(app)/citizen/grievances/GrievancesTable.tsx",
      target: "/citizen/grievances/",
      reason:
        "citizen/grievances/ only has a list page and a \"new\" page; no [id] detail page exists yet for a single grievance.",
    },
  ];

  // designer/[id]/**'s WizardShell computes its "select block" / "next" /
  // "previous" navigation target from apps/web/src/app/(app)/designer/
  // _data/designerConstants.ts's DEFAULT_BLOCKS array at runtime (plus one
  // redirect that appends a query-string suffix, not a path segment) -- an
  // identifier this analyzer can only ever see as an unresolved `${...}`
  // placeholder (see this analyzer's own header comment on why an
  // interpolation is never itself re-derived from the source that computes
  // it). Verified BY HAND instead, at the time this test was written:
  // DEFAULT_BLOCKS is exactly ["b1","b2","b3","b4","b5","b6","b7","b8"],
  // and every one of those already has a matching
  // apps/web/src/app/(app)/designer/[id]/bN/page.tsx -- so every runtime
  // value this code can actually produce resolves to a real route. This is
  // a narrow, file-path-scoped documented skip (not a blanket dynamic-link
  // carve-out): a genuinely new dead link anywhere else in the app,
  // including elsewhere under designer/, still fails the test below.
  const DESIGNER_WIZARD_NAV_COUNT = 27;
  function isDesignerWizardNav(d: LinkRow): boolean {
    return /^apps\/web\/src\/app\/\(app\)\/designer\/\[id\]\//.test(d.file) && d.target.startsWith("/designer/${params.id}/");
  }

  it("has no dead internal navigation links beyond the tracked exception ledger", () => {
    const exceptionKeys = new Set(KNOWN_EXCEPTIONS.map((e) => `${e.file}::${e.target}`));
    const unexpected = report.dead.filter((d) => !exceptionKeys.has(`${d.file}::${d.target}`) && !isDesignerWizardNav(d));

    if (unexpected.length > 0) {
      const details = unexpected
        .map((d) => `  [DEAD] ${d.file}:${d.line} (${d.kind}${d.fn ? " " + d.fn : ""}) ${d.target} -> ${d.resolved}`)
        .join("\n");
      expect.fail(
        `${unexpected.length} dead internal link(s) found (not in the tracked exception ledger):\n${details}\n\n` +
          `Run: node scripts/contract/route-existence.mjs --report\n` +
          `Fix the link (or the mapping helper that built it), or add it to KNOWN_EXCEPTIONS citing a gap ID.`,
      );
    }

    // The ledger itself must stay accurate -- an entry that no longer
    // reproduces means the underlying page/link shipped for real and the
    // exception is stale and must be deleted.
    const stillDead = new Set(report.dead.map((d) => `${d.file}::${d.target}`));
    const stale = KNOWN_EXCEPTIONS.filter((e) => !stillDead.has(`${e.file}::${e.target}`));
    if (stale.length > 0) {
      const details = stale.map((e) => `  ${e.id}  ${e.file}  target="${e.target}"`).join("\n");
      expect.fail(`${stale.length} KNOWN_EXCEPTIONS entry(ies) no longer reproduce -- remove them:\n${details}\n`);
    }
  });

  it("designer wizard's block-select/next/prev navigation stays within DEFAULT_BLOCKS' real routes (documented, not auto-checkable)", () => {
    const designerNav = report.dead.filter(isDesignerWizardNav);
    expect(
      designerNav.length,
      `Expected exactly ${DESIGNER_WIZARD_NAV_COUNT} designer/[id] wizard-navigation report(s) here (DEFAULT_BLOCKS-verified ` +
        `safe at authoring time), found ${designerNav.length}. If this count changed, designerConstants.ts's DEFAULT_BLOCKS or ` +
        `the designer/[id]/bN pages likely changed -- re-verify by hand that every block id still has a matching real page ` +
        `before updating this number:\n` +
        designerNav.map((d) => `  ${d.file}:${d.line} ${d.target}`).join("\n"),
    ).toBe(DESIGNER_WIZARD_NAV_COUNT);
  });

  it("keeps buildApprovalLink's finance_bill case pointed at a real route (regression, GAP-HR-SF-18)", () => {
    // Was `/finance/bills/${refId}`, which has never existed -- the real
    // route is `/finance/expenditure/bills/[id]`. This is the motivating bug
    // for this whole analyzer; pin it so it can't silently regress.
    const row = report.links.find(
      (l) => l.kind === "helperReturn" && l.fn === "buildApprovalLink" && l.file.endsWith("_data/loaders.ts") && l.target.startsWith("/finance/"),
    );
    expect(row, "expected to find buildApprovalLink's finance_bill case in the report").toBeDefined();
    expect(row!.ok, `${row!.target} does not resolve to a real route`).toBe(true);
  });

  it("reports the route-existence inventory (informational)", () => {
    const c = report.counts;
    console.log(
      `\nRoute-existence inventory: ${c.realRoutes} real routes, ${c.totalLinks} link candidates ` +
        `(${JSON.stringify(c.byKind)}), ${c.dead} dead`,
    );
    expect(typeof c.realRoutes).toBe("number");
  });

  describe("pure-function unit tests (route-existence.mjs)", () => {
    it("classifies dynamic segment shapes", () => {
      expect(routeSegmentType("employees")).toBe("static");
      expect(routeSegmentType("[id]")).toBe("single");
      expect(routeSegmentType("[...slug]")).toBe("multi");
      expect(routeSegmentType("[[...slug]]")).toBe("multi");
    });

    it("collapses a template interpolation to a wildcard segment", () => {
      const segs = toSegments("/hr/employees/${id}");
      expect(segs.map((s) => s.isParam)).toEqual([false, false, true]);
    });

    it("matches a static route exactly and rejects a wrong static segment", () => {
      expect(segsMatchRoute(["hr", "employees"], toSegments("/hr/employees"))).toBe(true);
      expect(segsMatchRoute(["hr", "employees"], toSegments("/hr/staff"))).toBe(false);
    });

    it("matches a single dynamic segment [id] against a concrete or interpolated value", () => {
      const route = ["finance", "expenditure", "bills", "[id]"];
      expect(segsMatchRoute(route, toSegments("/finance/expenditure/bills/42"))).toBe(true);
      expect(segsMatchRoute(route, toSegments("/finance/expenditure/bills/${refId}"))).toBe(true);
    });

    it("does NOT match a differently-shaped static prefix even with a trailing id (the finance_bill bug shape)", () => {
      // Only /finance/expenditure/bills/[id] exists; /finance/bills/[id] never did.
      const onlyRealRoute = ["finance", "expenditure", "bills", "[id]"];
      expect(segsMatchRoute(onlyRealRoute, toSegments("/finance/bills/${refId}"))).toBe(false);
    });

    it("does NOT let an interpolated segment match an unrelated static sibling route (the /stock/${rowId} shape)", () => {
      // Only /stock/list, /stock/dashboard etc. exist as *static* siblings --
      // no /stock/[id] dynamic route exists. A looser "param on either side
      // can't disprove" rule would wrongly resolve this; the stricter rule
      // this analyzer uses must not.
      expect(segsMatchRoute(["stock", "list"], toSegments("/stock/${rowId}"))).toBe(false);
      expect(segsMatchRoute(["stock", "dashboard"], toSegments("/stock/${rowId}"))).toBe(false);
    });

    it("treats a catch-all [...slug] as terminal, matching zero or more remaining segments", () => {
      // Mirrors screen-map.mjs's routeMatchesHref exactly: 'multi' short-
      // circuits to true the moment it's reached, regardless of how many
      // target segments (zero or more) remain. Real Next.js is actually
      // stricter here -- a non-optional `[...slug]` folder requires at
      // least one segment; only the double-bracket `[[...slug]]` matches
      // zero -- but routeSegmentType deliberately doesn't distinguish the
      // two (both map to "multi"), so this can only ever produce a false OK
      // on a bare zero-segment edge case, never a false DEAD. Consistent
      // with this analyzer's documented lean throughout: never invent a
      // stricter rule than the source it's copied from without a concrete
      // bug motivating it.
      const route = ["docs", "[...slug]"];
      expect(segsMatchRoute(route, toSegments("/docs/a/b/c"))).toBe(true);
      expect(segsMatchRoute(route, toSegments("/docs"))).toBe(true);
    });

    it("rejects a route requiring more segments than the target provides", () => {
      expect(segsMatchRoute(["hr", "employees", "[id]"], toSegments("/hr/employees"))).toBe(false);
    });

    it("isRoutePath excludes external, hash-only, mailto and API targets", () => {
      expect(isRoutePath("/hr/employees")).toBe(true);
      expect(isRoutePath("https://example.com")).toBe(false);
      expect(isRoutePath("//example.com")).toBe(false);
      expect(isRoutePath("#section")).toBe(false);
      expect(isRoutePath("mailto:a@b.com")).toBe(false);
      expect(isRoutePath("/api/v1/hr/employees")).toBe(false);
    });
  });
});
