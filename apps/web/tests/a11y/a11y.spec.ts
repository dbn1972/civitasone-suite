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
import { installApiMocks, MOCK_REQUIRED_ROUTES } from "./api-mocks.js";

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
  /**
   * `violation` = axe is certain. `incomplete` = axe could not decide (contrast
   * over gradients/images). Both are gated: silently dropping "don't know" is a
   * green-by-default bypass.
   */
  kind: "violation" | "incomplete";
};

type Baseline = { $comment: string; generatedAt: string; blocking: string[]; advisory: string[]; incompleteBlocking?: string[]; uncertified?: string[] };

function loadBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) {
    return { $comment: "", generatedAt: "", blocking: [], advisory: [], incompleteBlocking: [], uncertified: [] };
  }
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

const baseline = loadBaseline();
const collected: Finding[] = [];
const unreachable: { route: string; status: number | string }[] = [];
/** Routes that actually reached axe — used to prove the audited set is complete. */
const audited = new Set<string>();
/**
 * Routes that could NOT be certified because their data did not load, so the
 * data-bearing UI was absent. Tracked separately and ratcheted: these are
 * explicitly NOT "WCAG clean", they are "not measured".
 */
const uncertified = new Set<string>();

/** Stable key for the ratchet: a rule violated on a route. */
const key = (f: Finding): string => `${f.route}|${f.ruleId}`;

const routes: RouteSpec[] = FULL ? discoverAllRoutes() : CURATED_ROUTES;

// H3 — if discovery returns nothing (wrong APP_DIR, renamed route group) the
// suite would silently audit only the 2 public routes and report success.
if (routes.length < 40) {
  throw new Error(
    `Route manifest collapsed to ${routes.length} route(s) — expected >= 40. ` +
      `Refusing to run: a shrunken manifest produces a meaningless pass.`,
  );
}

// H1 — in WRITE mode the assertion is skipped entirely, so a stray env var in CI
// would turn this job into a guaranteed exit-0 no-op that asserts nothing.
if (WRITE && process.env.CI) {
  throw new Error(
    "A11Y_BASELINE_WRITE=1 must never be set in CI — it re-baselines instead of " +
      "asserting, which would silently launder new violations into the baseline.",
  );
}

/**
 * C1 — fail when the browser did not end up on the route we asked for.
 * A redirect means we are about to audit a different page than the one named.
 */
function assertLandedOnRequestedRoute(
  page: import("@playwright/test").Page,
  requested: string,
  persona: string,
): void {
  const landed = new URL(page.url()).pathname.replace(/\/$/, "") || "/";
  const want = requested.replace(/\/$/, "") || "/";
  expect(
    landed,
    `${requested} REDIRECTED to ${landed} as ${persona}.\n` +
      `This app redirects on authorization failure instead of returning 403, so auditing\n` +
      `here would produce a clean result for a page that was never rendered.\n` +
      `Fix: correct the persona in routes.ts, or grant the persona the required role.`,
  ).toBe(want);
}

/**
 * C4 — establish a positive precondition before auditing.
 *
 * Previously this waited for `main` with `.catch(() => undefined)`, which made
 * "the shell never rendered" indistinguishable from success — axe then ran on a
 * blank DOM, found nothing, and the route was recorded as clean. `main` also
 * comes from the layout and is present long before client components mount, so
 * client-rendered violations fell outside the audit window.
 */
async function waitForAuditableContent(
  page: import("@playwright/test").Page,
  route: string,
): Promise<void> {
  // No .catch() — a missing app shell must fail the test, not pass it.
  await page.waitForSelector("main, [role='main']", { timeout: 20_000 });

  // Wait for the page heading, which every DS page renders via PageHeader. This
  // is the signal that the server component resolved rather than still
  // streaming a fallback.
  await expect(
    page.locator("main h1, main h2, [role='main'] h1").first(),
    `${route} rendered <main> but no heading — the page is still a shell/skeleton, ` +
      `and auditing a skeleton is a false pass.`,
  ).toBeVisible({ timeout: 20_000 });

  // Let loading skeletons resolve so the real controls are in the DOM.
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll("[data-loading='true'], .skeleton, [aria-busy='true']")
          .length === 0,
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => undefined); // absence of skeletons is best-effort, not a gate
}

/**
 * C2 — refuse to audit a page whose data never arrived.
 *
 * When the gateway is unreachable every loader returns `source: "error"` and the
 * page renders an empty state. The DataTable, its rows, sort controls, status
 * pills, pagination and export button — the data-bearing UI where accessibility
 * defects actually live — are then absent from the DOM, so axe audits a shell and
 * reports it clean. `DataSourceBadge` renders "Showing saved information" exactly
 * in that case, which makes it detectable.
 */
async function checkDataArrived(
  page: import("@playwright/test").Page,
  spec: RouteSpec,
): Promise<boolean> {
  if (spec.archetype === "hub" || spec.archetype === "form") return true; // no loaders
  const errorBadge = page.getByText("Showing saved information", { exact: false });
  return (await errorBadge.count()) === 0;
}

/**
 * C3 — collect BOTH `violations` and `incomplete`.
 *
 * axe puts everything it could not decide into `incomplete`, and contrast over
 * gradients/images/transparency is the canonical case. Dropping it silently is a
 * green-by-default bypass: /auth/login reports 0 violations and 6 serious
 * color-contrast nodes in `incomplete`.
 */
function record(route: string, results: { violations: unknown[]; incomplete: unknown[] }): void {
  type AxeResult = {
    id: string;
    impact?: string | null;
    help: string;
    nodes: { target?: unknown[] }[];
  };
  const push = (v: AxeResult, kind: Finding["kind"]): void => {
    collected.push({
      route,
      ruleId: v.id,
      impact: v.impact ?? "unknown",
      help: v.help,
      nodeCount: v.nodes.length,
      sampleTarget: String(v.nodes[0]?.target?.[0] ?? "?"),
      kind,
    });
  };
  for (const v of results.violations as AxeResult[]) push(v, "violation");
  for (const v of results.incomplete as AxeResult[]) push(v, "incomplete");
}

test.describe("WCAG 2.2 AA — authenticated routes", () => {
  for (const spec of routes) {
    test(`${spec.path} [${spec.persona}/${spec.archetype}]`, async ({ page, baseURL }) => {
      await authenticate(page.context(), spec.persona, baseURL!);

      // Install API mocks for routes that need gateway data to render their
      // data-bearing UI (DataTable, pagination, sort controls).
      if (MOCK_REQUIRED_ROUTES.has(spec.path)) {
        await installApiMocks(page);
      }

      const response = await page.goto(spec.path, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      const status = response?.status() ?? "no-response";
      if (typeof status === "number" && status >= 400) {
        unreachable.push({ route: spec.path, status });
        expect(
          status,
          `${spec.path} returned ${status} as ${spec.persona}. The gate refuses to audit an ` +
            `error shell — a clean axe run on a 403 page is a false pass.`,
        ).toBeLessThan(400);
        return;
      }

      // C1 — `page.goto()` returns the FINAL response after redirects, and this
      // app REDIRECTS on authorization failure (roleGuard.ts calls
      // redirect("/dashboard"), middleware redirects to /auth/dev) rather than
      // returning 403. Without this check, a route the persona cannot access
      // lands on /dashboard with status 200, passes the >=400 check, gets
      // audited, and its clean result is filed under the route that was never
      // rendered. Asserting the landed pathname is what makes the audit honest.
      assertLandedOnRequestedRoute(page, spec.path, spec.persona);

      await waitForAuditableContent(page, spec.path);

      // C2 — a page whose data never arrived renders an empty state: no
      // DataTable, no rows, no sort/filter/export controls. Auditing that shell
      // and calling it clean is a false pass, so the route is recorded as NOT
      // CERTIFIED rather than counted as passing.
      const hasData = await checkDataArrived(page, spec);
      if (!hasData) {
        uncertified.add(spec.path);
        audited.add(spec.path);
        return;
      }

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      record(spec.path, results);
      audited.add(spec.path);
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
      assertLandedOnRequestedRoute(page, spec.path, "anonymous");

      // Public auth pages have no <main>/<h1> contract, so wait for the form.
      await page.waitForSelector("form, main", { timeout: 20_000 });

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      record(spec.path, results);
      audited.add(spec.path);
    });
  }
});

test.afterAll(() => {
  const isSevere = (f: Finding): boolean =>
    f.impact === "critical" || f.impact === "serious";

  const blocking = collected.filter((f) => f.kind === "violation" && isSevere(f));
  const incompleteSevere = collected.filter((f) => f.kind === "incomplete" && isSevere(f));
  const advisory = collected.filter((f) => f.kind === "violation" && !isSevere(f));

  const blockingKeys = [...new Set(blocking.map(key))].sort();
  const incompleteKeys = [...new Set(incompleteSevere.map(key))].sort();
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
          counts: {
            blocking: blockingKeys.length,
            incompleteBlocking: incompleteKeys.length,
            advisory: advisoryKeys.length,
            uncertified: uncertified.size,
          },
          blocking: blockingKeys,
          incompleteBlocking: incompleteKeys,
          advisory: advisoryKeys,
          uncertified: [...uncertified].sort(),
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
  const knownIncomplete = new Set(baseline.incompleteBlocking ?? []);
  const incompleteRegressions = incompleteKeys.filter((k) => !knownIncomplete.has(k));

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

  // H3 — prove every manifest route actually reached axe. Without this, a route
  // that threw early simply contributes no findings and reads as clean.
  const expected = [...routes.map((r) => r.path), ...PUBLIC_ROUTES.map((r) => r.path)].sort();
  const missing = expected.filter((r) => !audited.has(r));
  expect(
    missing,
    `\n${missing.length} route(s) in the manifest never reached the axe audit. A route that\n` +
      `errors early contributes no findings and would otherwise read as clean:\n` +
      `${missing.map((r) => `    ${r}`).join("\n")}\n`,
  ).toEqual([]);

  // Ratchet the not-measured set. A route losing its data (so it can no longer
  // be audited) must not read as an improvement.
  const knownUncertified = new Set(baseline.uncertified ?? []);
  const newUncertified = [...uncertified].filter((r) => !knownUncertified.has(r)).sort();
  expect(
    newUncertified,
    `\n${newUncertified.length} route(s) newly UNCERTIFIABLE — their data did not load, so the\n` +
      `DataTable and its controls were absent and accessibility could not be measured.\n` +
      `This is NOT a pass; the route is unmeasured.\n` +
      `${newUncertified.map((r) => `    ${r}`).join("\n")}\n`,
  ).toEqual([]);

  if (uncertified.size > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[a11y] ⚠️  ${uncertified.size} route(s) NOT CERTIFIED (data unavailable, not audited): ` +
        `${[...uncertified].sort().join(", ")}`,
    );
  }

  expect(
    regressions,
    `\n${regressions.length} NEW WCAG 2.2 AA violation(s) at critical/serious impact.\n` +
      `Government accessibility compliance (GIGW 3.0) is mandatory — these block merge.\n\n` +
      `${regressions.map(detail).join("\n\n")}\n`,
  ).toEqual([]);

  // C3 — axe "incomplete" at critical/serious is gated too. These are cases axe
  // could not decide automatically (contrast over gradients/images). They are
  // NOT passes; each needs a human contrast check or a code change that makes the
  // computation decidable.
  expect(
    incompleteRegressions,
    `\n${incompleteRegressions.length} NEW UNDECIDED WCAG check(s) at critical/serious impact.\n` +
      `axe could not automatically determine compliance — usually text over a gradient,\n` +
      `image, or semi-transparent background. Treat as a violation until proven otherwise:\n` +
      `${incompleteRegressions.map((k) => `    ${k}`).join("\n")}\n`,
  ).toEqual([]);
});
