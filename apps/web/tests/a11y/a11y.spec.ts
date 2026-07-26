/**
 * Gate #9 — REAL accessibility gate (WCAG 2.2 AA).
 *
 * Replaces the static-analysis proxy in `scripts/ci/wcag-audit.mjs`, which
 * regex-scans `page.tsx` source text and therefore cannot see any violation
 * originating in a client component, a shared DS primitive, or a runtime state
 * (loading skeleton, empty state, error boundary). This gate loads each route in
 * a real browser as a real persona and runs axe-core against the rendered DOM.
 *
 * FAILS ON: critical + serious violations. Moderate/minor are reported so they
 * can be burned down, but do not block — blocking on every minor axe rule across
 * 410 pages would force a mass-allowlist, which is a fake gate with extra steps.
 *
 * RATCHET: `a11y-baseline.json` records the (route, ruleId) pairs that exist
 * today. A NEW pair fails the build. This does not assert the existing ones are
 * acceptable — they are tracked debt in docs/QA-GATES.md.
 *
 * Run:
 *   pnpm --filter @civitasone/web test:a11y            # curated set
 *   A11Y_FULL=1 pnpm --filter @civitasone/web test:a11y # every (app) route
 *   A11Y_BASELINE_WRITE=1 pnpm --filter @civitasone/web test:a11y  # re-baseline
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { CURATED_ROUTES, PUBLIC_ROUTES, type RouteSpec } from "./routes.js";
import { authenticate } from "./persona-auth.js";
import { discoverAllRoutes } from "./discover.js";

const BASELINE_PATH = join(__dirname, "a11y-baseline.json");
const WRITE = process.env.A11Y_BASELINE_WRITE === "1";
const FULL = process.env.A11Y_FULL === "1";

/** WCAG 2.2 AA tag set. `best-practice` is deliberately excluded — it is not the mandate. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type Finding = {
  route: string;
  ruleId: string;
  impact: string;
  help: string;
  nodeCount: number;
  sampleTarget: string;
};

type Baseline = { $comment: string; generatedAt: string; blocking: string[]; advisory: string[] };

function loadBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) {
    return { $comment: "", generatedAt: "", blocking: [], advisory: [] };
  }
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

const baseline = loadBaseline();
const collected: Finding[] = [];
const unreachable: { route: string; status: number | string }[] = [];

/** Stable key for the ratchet: a rule violated on a route. */
const key = (f: Finding): string => `${f.route}|${f.ruleId}`;

const routes: RouteSpec[] = FULL ? discoverAllRoutes() : CURATED_ROUTES;

test.describe("WCAG 2.2 AA — authenticated routes", () => {
  for (const spec of routes) {
    test(`${spec.path} [${spec.persona}/${spec.archetype}]`, async ({ page, baseURL }) => {
      await authenticate(page.context(), spec.persona, baseURL!);

      const response = await page.goto(spec.path, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      const status = response?.status() ?? "no-response";
      if (typeof status === "number" && status >= 400) {
        // Auditing a 403/404/500 shell would produce a meaningless pass. Record
        // it as a route failure so the gate cannot be satisfied by broken pages.
        unreachable.push({ route: spec.path, status });
        expect(
          status,
          `${spec.path} returned ${status} as ${spec.persona}. The accessibility gate ` +
            `refuses to audit an error shell — a clean axe run on a 403 page is a false pass. ` +
            `Fix the route or correct the persona in routes.ts.`,
        ).toBeLessThan(400);
        return;
      }

      // Let client components hydrate and skeletons resolve. Networkidle is
      // unreliable here (SyncProvider polls), so wait for the app shell instead.
      await page
        .waitForSelector("main, [role='main']", { timeout: 15_000 })
        .catch(() => undefined);

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

      for (const v of results.violations) {
        collected.push({
          route: spec.path,
          ruleId: v.id,
          impact: v.impact ?? "unknown",
          help: v.help,
          nodeCount: v.nodes.length,
          sampleTarget: String(v.nodes[0]?.target?.[0] ?? "?"),
        });
      }
    });
  }
});

test.describe("WCAG 2.2 AA — public routes", () => {
  for (const spec of PUBLIC_ROUTES) {
    test(`${spec.path} [anonymous/${spec.archetype}]`, async ({ page, baseURL }) => {
      await page.context().clearCookies();
      const response = await page.goto(spec.path, { waitUntil: "domcontentloaded" });
      const status = response?.status() ?? 0;
      expect(status, `${spec.path} returned ${status}`).toBeLessThan(400);

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      for (const v of results.violations) {
        collected.push({
          route: spec.path,
          ruleId: v.id,
          impact: v.impact ?? "unknown",
          help: v.help,
          nodeCount: v.nodes.length,
          sampleTarget: String(v.nodes[0]?.target?.[0] ?? "?"),
        });
      }
    });
  }
});

test.afterAll(() => {
  const blocking = collected.filter(
    (f) => f.impact === "critical" || f.impact === "serious",
  );
  const advisory = collected.filter(
    (f) => f.impact !== "critical" && f.impact !== "serious",
  );

  const blockingKeys = [...new Set(blocking.map(key))].sort();
  const advisoryKeys = [...new Set(advisory.map(key))].sort();

  if (WRITE) {
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify(
        {
          $comment:
            "GENERATED WCAG 2.2 AA DEFECT BASELINE — these are KNOWN VIOLATIONS, not " +
            "approved exceptions. GIGW 3.0 requires them fixed. The gate fails on any NEW " +
            "(route|rule) pair. Regenerate only after a real fix: " +
            "A11Y_BASELINE_WRITE=1 pnpm --filter @civitasone/web test:a11y",
          generatedAt: new Date().toISOString().slice(0, 10),
          mode: FULL ? "full" : "curated",
          counts: { blocking: blockingKeys.length, advisory: advisoryKeys.length },
          blocking: blockingKeys,
          advisory: advisoryKeys,
        },
        null,
        2,
      )}\n`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[a11y] baseline written: ${blockingKeys.length} blocking, ${advisoryKeys.length} advisory`,
    );
    return;
  }

  const known = new Set(baseline.blocking);
  const regressions = blockingKeys.filter((k) => !known.has(k));
  const fixed = baseline.blocking.filter((k) => !blockingKeys.includes(k));

  const detail = (k: string): string => {
    const f = blocking.find((x) => key(x) === k);
    if (!f) return `    ${k}`;
    return `    ${f.route}\n      rule: ${f.ruleId} (${f.impact})\n      ${f.help}\n      ${f.nodeCount} node(s), e.g. ${f.sampleTarget}`;
  };

  // eslint-disable-next-line no-console
  console.log(
    `[a11y] audited ${routes.length + PUBLIC_ROUTES.length} route(s): ` +
      `${blockingKeys.length} blocking, ${advisoryKeys.length} advisory ` +
      `(baseline: ${baseline.blocking.length} blocking)`,
  );

  if (fixed.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[a11y] ${fixed.length} baselined violation(s) are FIXED — re-baseline so they ` +
        `cannot regress silently:\n${fixed.map((k) => `    ${k}`).join("\n")}`,
    );
  }

  expect(
    regressions,
    `\n${regressions.length} NEW WCAG 2.2 AA violation(s) at critical/serious impact.\n` +
      `Government accessibility compliance (GIGW 3.0) is mandatory — these block merge.\n\n` +
      `${regressions.map(detail).join("\n\n")}\n`,
  ).toEqual([]);
});
