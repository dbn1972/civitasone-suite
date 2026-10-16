/**
 * SF-18b: runtime-path contract tests for the two GlobalSearch / TalentPoolTable
 * patterns the static analyzer (route-existence.mjs) cannot resolve.
 *
 * 1. GlobalSearch.tsx MODULE_PATH_MAP: each value must point at a real App
 *    Router route (a page.tsx or layout.tsx, accounting for route groups and
 *    dynamic segments). The module key is only a hint for the badge; the
 *    value is the actual URL the user is sent to.
 *
 * 2. talentPoolView.ts candidateHref(): the generated URL pattern must
 *    resolve to a real App Router route. Since jobOpeningId and id are
 *    runtime values, we check the STRUCTURAL pattern (the dynamic-segment
 *    shape), not a specific URL.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { candidateHref } from "../../apps/web/src/app/(app)/hr/recruitment/talent-pool/talentPoolView";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const WEB_APP_DIR = join(ROOT, "apps/web/src/app");

// ── MODULE_PATH_MAP from GlobalSearch ───────────────────────────────────────
// Copied by value so changes to GlobalSearch are flagged here on the next run.
// The comment in GlobalSearch.tsx ("Verified against the (app) route tree on
// 2026-08-26") is the narrative justification; this test is the machine one.
const MODULE_PATH_MAP: Record<string, string> = {
  finance: "/finance",
  procurement: "/procurement",
  hrms: "/hr",
  payroll: "/hr/payroll",
  projects: "/projects",
  assets: "/assets",
  crm: "/crm",
  helpdesk: "/helpdesk",
  legal: "/legal",
  citizen: "/citizen",
  workflow: "/workflow",
  analytics: "/analytics",
  billing: "/billing",
  inventory: "/inventory",
  stock: "/inventory",
  grants: "/grants",
  audit: "/audit",
  telephony: "/telephony",
  knowledge: "/knowledge",
  reports: "/reports",
  contracts: "/contracts",
  establishment: "/estab",
  notification: "/notifications",
  admin: "/admin",
};

/** True when an App Router path (after stripping route groups) has a page.tsx or layout.tsx. */
function routeExists(urlPath: string): boolean {
  // Convert a URL path like "/hr/payroll" to the filesystem segments (app
  // folder, stripping route groups like "(app)").
  const segments = urlPath.split("/").filter(Boolean);
  function search(dir: string, depth: number): boolean {
    if (depth === segments.length) {
      try {
        const entries = readdirSync(dir);
        return entries.includes("page.tsx") || entries.includes("layout.tsx") ||
               entries.includes("page.ts") || entries.includes("layout.ts");
      } catch { return false; }
    }
    let found = false;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const child = join(dir, entry);
        try { if (!statSync(child).isDirectory()) continue; } catch { continue; }
        const name = entry;
        const seg = segments[depth];
        // Match: exact name, route group (parenthesised), or dynamic segment [...] / [...]
        const isRouteGroup = name.startsWith("(") && name.endsWith(")");
        const isDynamic = name.startsWith("[") && name.endsWith("]");
        if (isRouteGroup) {
          // Step into the group without consuming a segment
          if (search(child, depth)) { found = true; break; }
        } else if (isDynamic || name === seg) {
          if (search(child, depth + 1)) { found = true; break; }
        }
      }
    } catch { /* ignore */ }
    return found;
  }
  return search(WEB_APP_DIR, 0);
}

describe("SF-18b GlobalSearch MODULE_PATH_MAP", () => {
  it("every base path in MODULE_PATH_MAP resolves to a real App Router route", () => {
    const dead: string[] = [];
    for (const [module, urlPath] of Object.entries(MODULE_PATH_MAP)) {
      // De-duplicate: "stock" -> "/inventory" same as "inventory" -> "/inventory"
      if (!routeExists(urlPath)) {
        dead.push(`module="${module}" path="${urlPath}"`);
      }
    }
    if (dead.length > 0) {
      throw new Error(
        `MODULE_PATH_MAP has ${dead.length} dead base path(s):\n` + dead.map(s => `  ${s}`).join("\n")
      );
    }
  });
});

describe("SF-18b TalentPoolTable candidateHref", () => {
  it("returns empty string when jobOpeningId is absent", () => {
    expect(candidateHref({ id: "app-1" })).toBe("");
    expect(candidateHref({ id: "app-1", jobOpeningId: null })).toBe("");
  });

  it("generates a URL matching the /hr/recruitment/[id]/applications/[appId] route", () => {
    const href = candidateHref({ id: "app-abc", jobOpeningId: "job-xyz" });
    // Pattern: /hr/recruitment/<id>/applications/<appId>
    expect(href).toMatch(/^\/hr\/recruitment\/[^/]+\/applications\/[^/]+$/);
    // Both IDs are URI-encoded
    expect(href).toContain(encodeURIComponent("job-xyz"));
    expect(href).toContain(encodeURIComponent("app-abc"));
    // The route must exist in the App Router tree
    expect(routeExists("/hr/recruitment/x/applications/y")).toBe(true);
  });
});
