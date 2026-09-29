/**
 * hr-role-matrix.contract.test.ts — GAP-HR-SF-09a
 *
 * Runs scripts/contract/hr-role-matrix.mjs (static analyzer, no running
 * services) and asserts that hr/layout.tsx's shared HR_ROLES, and every
 * /hr, /hr/payroll or /hr/recruitment page with its own dedicated role gate,
 * agree with what services/hrms-service and services/payroll-service's own
 * `requireRole(ctx, ...)` route guards actually admit.
 *
 * This is NOT a fix-everything gate. GAP-HR-SF-09a is explicitly the
 * detection half of a two-part fix (see the campaign plan): every drift the
 * analyzer already knows about is named, with a reason, in
 * tests/contract/hr-role-matrix.allowlist.json, and this test passes today
 * BECAUSE of that allowlist, not despite it. What it protects against is a
 * *new*, previously-unknown drift landing unnoticed -- add a route whose
 * role list disagrees with its page in a new way, and this test fails with
 * the exact route, both role lists, and which direction disagrees, pointing
 * straight at the allowlist file that needs a new GAP-tagged entry (which
 * means: go find out why, don't just add it to make the test green).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const SCRIPT = join(ROOT, "scripts/contract/hr-role-matrix.mjs");
const REPORT_PATH = join(ROOT, "scripts/contract/hr-role-matrix.json");
const ALLOWLIST_PATH = join(import.meta.dirname, "hr-role-matrix.allowlist.json");

type RouteRow = {
  service: string;
  file: string;
  method: string;
  routePath: string;
  line: number;
  roles: string[] | null;
  comparator: string | null;
  comparatorRoles?: string[];
  extraInBackend?: string[];
  extraInWeb?: string[];
  status: "MATCH" | "DRIFT" | "NO_ROLE_CHECK" | "OUT_OF_SCOPE" | "DYNAMIC";
};

type Report = {
  generatedAt: string;
  webHrRoles: string[];
  counts: Record<string, number>;
  routes: RouteRow[];
};

type AllowlistDriftEntry = {
  id: string;
  match: { comparator: string; extraInBackend: string[]; extraInWeb: string[] };
  routeCount: number;
  reason: string;
};

type Allowlist = {
  driftEntries: AllowlistDriftEntry[];
  noRoleCheckEntries: { id: string; routeCount: number; reason: string }[];
  dynamicEntries: { id: string; routeCount: number; reason: string }[];
  noBackendRouteFound: { id: string; webArea: string; reason: string }[];
};

function sortedKey(comparator: string | null, extraInBackend: string[], extraInWeb: string[]): string {
  return JSON.stringify({
    comparator,
    extraInBackend: [...extraInBackend].sort(),
    extraInWeb: [...extraInWeb].sort(),
  });
}

function routeLabel(r: RouteRow): string {
  return `${r.service} ${r.file}:${r.line} ${r.method} ${r.routePath}`;
}

let report: Report;
let allowlist: Allowlist;

beforeAll(() => {
  // Re-run the analyzer so this test always reflects current source, not a
  // stale committed snapshot -- both the web pages' role consts and the
  // backend routes' requireRole calls are read live from disk every time.
  execSync(`node ${SCRIPT}`, { stdio: "pipe", cwd: ROOT });
  report = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as Report;
  allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as Allowlist;
}, 60_000);

describe("hr role-matrix contract", () => {
  it("analyzer actually ran and found a healthy number of routes both ways", () => {
    // Guards against a broken analyzer silently reporting nothing (which
    // would make every assertion below vacuously pass). 783 routes/543
    // matches at the time this test was written; only a floor, not pinned,
    // so ordinary route additions don't need this test touched.
    const total = Object.values(report.counts).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(700);
    expect(report.counts.MATCH ?? 0).toBeGreaterThan(500);
  });

  it("hr/layout.tsx's shared HR_ROLES still carries the roles self-service and every specially-gated page depend on", () => {
    // Coarse sanity check on the analyzer's own read of the shared constant
    // (the detailed, exhaustive version of this lives in hr/layout.test.tsx
    // and workRoles.test.ts, which exercise actual admit/deny behaviour).
    for (const role of ["hr_admin", "hr_officer", "manager", "employee", "payroll_admin", "payroll_officer", "tenant_admin", "platform_admin", "super_admin"]) {
      expect(report.webHrRoles).toContain(role);
    }
  });

  it("every DRIFT the analyzer finds is a currently-known, GAP-tagged one -- no new drift has appeared", () => {
    const allowMap = new Map<string, AllowlistDriftEntry>();
    for (const entry of allowlist.driftEntries) {
      allowMap.set(sortedKey(entry.match.comparator, entry.match.extraInBackend, entry.match.extraInWeb), entry);
    }

    const drifts = report.routes.filter((r) => r.status === "DRIFT");
    const unlisted: string[] = [];
    const seenCounts = new Map<string, number>();

    for (const r of drifts) {
      const key = sortedKey(r.comparator, r.extraInBackend ?? [], r.extraInWeb ?? []);
      const entry = allowMap.get(key);
      if (!entry) {
        unlisted.push(
          `${routeLabel(r)} -- comparator=${r.comparator} extraInBackend=${JSON.stringify(r.extraInBackend)} extraInWeb=${JSON.stringify(r.extraInWeb)}`,
        );
        continue;
      }
      seenCounts.set(entry.id, (seenCounts.get(entry.id) ?? 0) + 1);
    }

    expect(
      unlisted,
      `${unlisted.length} DRIFT route(s) are not covered by any tests/contract/hr-role-matrix.allowlist.json entry. ` +
        `Each one is a NEW web-vs-backend role mismatch under /hr, /hr/payroll or /hr/recruitment. ` +
        `Find out why (a genuine bug, or an intentional narrowing that needs its own GAP id), then add a ` +
        `driftEntries entry naming it -- do not widen an existing entry's match to absorb an unrelated route:\n` +
        unlisted.join("\n"),
    ).toEqual([]);

    // Every allowlist entry's declared routeCount must still match reality,
    // in both directions: an entry whose routes have all been fixed (count
    // now 0) is stale and should be removed, not silently ignored; one whose
    // count grew silently absorbed a new drift instead of surfacing it.
    for (const entry of allowlist.driftEntries) {
      expect(seenCounts.get(entry.id) ?? 0, `${entry.id}: expected ${entry.routeCount} matching route(s), found ${seenCounts.get(entry.id) ?? 0}. If routes were fixed, remove or shrink this allowlist entry rather than leaving a stale count.`).toBe(
        entry.routeCount,
      );
    }
  });

  it("every route with NO role check at all is a currently-known, GAP-tagged one", () => {
    const noCheck = report.routes.filter((r) => r.status === "NO_ROLE_CHECK");
    const entry = allowlist.noRoleCheckEntries[0];
    expect(
      noCheck.length,
      `Expected exactly ${entry?.routeCount ?? 0} route(s) with no requireRole/requirePermissionKey call at all ` +
        `(tracked under ${entry?.id}), found ${noCheck.length}:\n` +
        noCheck.map(routeLabel).join("\n"),
    ).toBe(entry?.routeCount ?? 0);
  });

  it("every route with a dynamic (non-static) role check is a currently-known, GAP-tagged one", () => {
    const dynamic = report.routes.filter((r) => r.status === "DYNAMIC");
    const entry = allowlist.dynamicEntries[0];
    expect(
      dynamic.length,
      `Expected exactly ${entry?.routeCount ?? 0} route(s) with a runtime-computed role check this static analyzer ` +
        `cannot resolve (tracked under ${entry?.id}), found ${dynamic.length}:\n` +
        dynamic.map(routeLabel).join("\n"),
    ).toBe(entry?.routeCount ?? 0);
  });

  it("hr/locations/new's backend mapping remains an open, tracked question (GAP-HR-SF09A-018)", () => {
    // No route in hrms-service or payroll-service serves this page (see the
    // allowlist entry for the full explanation) -- this is documented here,
    // not asserted against a live route, precisely because there IS no
    // route to compare against yet.
    const entry = allowlist.noBackendRouteFound.find((e) => e.id === "GAP-HR-SF09A-018");
    expect(entry).toBeDefined();
    expect(report.routes.some((r) => r.comparator?.startsWith("page:locations"))).toBe(false);
  });
});
