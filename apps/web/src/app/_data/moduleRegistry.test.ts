import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { hasRoleFamily } from "@/lib/auth/roleGuard";
import { MODULE_REGISTRY, MODULE_COUNT } from "@/app/_data/moduleRegistry";
import { LINKABLE_INTERMEDIATE_PATHS } from "@/app/_components/navRouteManifest";

describe("GAP-DASHBOARD-HOME-2-02: hasRoleFamily", () => {
  it("matches the exact family name", () => {
    expect(hasRoleFamily(["hr"], "hr")).toBe(true);
  });

  it("matches a role prefixed by family + '_'", () => {
    expect(hasRoleFamily(["hr_officer"], "hr")).toBe(true);
  });

  it("matches a role prefixed by family + ':'", () => {
    expect(hasRoleFamily(["finance:admin"], "finance")).toBe(true);
  });

  it("does NOT match a substring in the middle of a role (the old bug)", () => {
    // "chr_manager".includes("hr") was true under the old substring test.
    expect(hasRoleFamily(["chr_manager"], "hr")).toBe(false);
  });

  it("does NOT match an unrelated family", () => {
    expect(hasRoleFamily(["hr_officer"], "finance")).toBe(false);
  });

  it("returns false for empty roles", () => {
    expect(hasRoleFamily([], "hr")).toBe(false);
  });

  it("matches when any one of several roles belongs to the family", () => {
    expect(hasRoleFamily(["citizen", "hr_admin"], "hr")).toBe(true);
  });
});

describe("GAP-DASHBOARD-HOME-01 / HOME-2-03: module registry", () => {
  it("MODULE_COUNT equals the registry length", () => {
    expect(MODULE_COUNT).toBe(MODULE_REGISTRY.length);
  });

  it("includes modules that were missing from the old 17-item dashboard array", () => {
    const hrefs = new Set(MODULE_REGISTRY.map((m) => m.href));
    for (const href of ["/court", "/designer", "/visitor", "/meeting", "/inspection", "/revenue", "/billing"]) {
      expect(hrefs.has(href)).toBe(true);
    }
  });

  it("every entry has a non-empty label, href and icon", () => {
    for (const m of MODULE_REGISTRY) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.href.startsWith("/")).toBe(true);
      expect(m.icon.length).toBeGreaterThan(0);
    }
  });

  it("GAP-DASHBOARD-HOME-2-03: every MODULE_REGISTRY href maps to an existing (app) route directory", () => {
    // Guards against phantom registry entries pointing to routes that no longer exist.
    const appDir = join(__dirname, "..", "(app)");
    const missing: string[] = [];
    for (const entry of MODULE_REGISTRY) {
      const routeDir = join(appDir, entry.href.slice(1)); // strip leading /
      if (!existsSync(routeDir)) {
        missing.push(entry.href);
      }
    }
    expect(missing, `Registry entries with no matching (app)/ directory: ${missing.join(", ")}`).toEqual([]);
  });

  it("GAP-DASHBOARD-HOME-2-03: every top-level (app) route in navRouteManifest that is a module has a registry entry", () => {
    // Guards against new module routes added to navRouteManifest without a MODULE_REGISTRY entry.
    // Only top-level single-segment paths are checked (e.g. "/finance" but not "/finance/budget").
    //
    // UTILITY_ROUTES_EXEMPT: paths that are intentionally NOT module tiles (utility/admin/sub-module
    // paths). Add to this list ONLY when the route genuinely is not a module tile (e.g. a shared
    // sub-module already covered by a parent, a pure utility with no entitlement gate, or an
    // admin-only tool). Document the reason inline. If a route here later becomes a module tile,
    // remove it from this list and add it to MODULE_REGISTRY.
    const UTILITY_ROUTES_EXEMPT = new Set<string>([
      "/admin",          // always-on admin utility (tenant + platform admins)
      "/analytics",      // platform analytics, no Sidebar moduleKey
      "/change",         // change & release, internal admin tool
      "/fleet",          // sub-module of /assets (shares moduleKey "assets")
      "/install",        // onboarding wizard, not a module tile
      "/inventory",      // sub-module of /stock (older name)
      "/learning",       // sub-module of /hr (shares moduleKey "hrms")
      "/locations",      // utility nav, moduleKey: null in Sidebar
      "/metadata",       // admin config utility
      "/platform-admin", // platform-level (not tenant) admin
      "/plugins",        // plugin management utility
      "/policy",         // policy/SOP viewer, sub-feature of knowledge
      "/themes",         // theme management, accessed via /settings
      "/workflow",       // approvals workflow inbox (cross-module link, not a tile)
    ]);

    const registryHrefs = new Set(MODULE_REGISTRY.map((m) => m.href));

    // Filter LINKABLE_INTERMEDIATE_PATHS to top-level single-segment paths
    const topLevelModuleRoutes = [...LINKABLE_INTERMEDIATE_PATHS].filter(
      (p) => p.startsWith("/") && !p.slice(1).includes("/"),
    );

    const unregistered = topLevelModuleRoutes.filter(
      (p) => !registryHrefs.has(p) && !UTILITY_ROUTES_EXEMPT.has(p),
    );

    expect(
      unregistered,
      `These top-level routes are in navRouteManifest but have no MODULE_REGISTRY entry and are not in UTILITY_ROUTES_EXEMPT. ` +
        `Add them to MODULE_REGISTRY (if they are module tiles) or to UTILITY_ROUTES_EXEMPT (if they are utility/sub-module routes). ` +
        `Unregistered: ${unregistered.join(", ")}`,
    ).toEqual([]);
  });
});
