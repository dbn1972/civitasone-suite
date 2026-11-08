import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { NAV_GROUPS, isNavItemVisible, visibleNavGroups } from "./navModel";
import { PAGE_INDEX, searchPages } from "./pageIndex";
import * as roleGuard from "@/lib/auth/roleGuard";
import * as navRoles from "@/lib/auth/navRoles";
import * as workRoles from "@/lib/auth/workRoles";
import * as adminRoles from "@/lib/auth/adminRoles";
import * as identityRoles from "@/lib/auth/identityRoles";
import * as meetingRoles from "@/lib/auth/meetingRoles";
import * as payrollRunRoles from "@/lib/auth/payrollRunRoles";
import * as grantsRoles from "@/app/(app)/grants/roles";
import * as tenantRoles from "@/app/(app)/tenant/_roles";

/**
 * UAT-P3 PR #2461 review, blocker 1: the sidebar and the search index offered
 * ten destinations (Projects, CRM, Inspection, Locations x3, Audit, Legal,
 * Loyalty, Catalogue, Recommendations, Reports, /approvals) that the
 * destination layout redirects an employee away from, and the old tests only
 * checked that <href>/page.tsx exists. This reads the guard out of every
 * layout on the path to each nav/search entry and requires the entry to carry
 * rolesAllowed that is a subset of what the layout admits, so the two cannot
 * drift again.
 */
const APP = join(process.cwd(), "src/app/(app)");
const NS: Record<string, unknown> = { ...workRoles, ...adminRoles, ...identityRoles, ...meetingRoles, ...payrollRunRoles, ...grantsRoles, ...tenantRoles, ...navRoles, ...roleGuard };

/** Role names a layout's requireAnyRole/hasAnyRole guard admits; null = no guard. */
function layoutGuard(file: string): Set<string> | null {
  const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const m = /(?:requireAnyRole|hasAnyRole)\(([^;]*?)\)\s*[;){]/.exec(src);
  if (!m) return null;
  const names = new Set<string>();
  const idents = m[1].match(/\b[A-Z][A-Z0-9_]{3,}\b/g) ?? [];
  for (const id of idents) {
    const v = NS[id];
    if (!Array.isArray(v)) throw new Error(`${file}: guard constant ${id} is not resolvable by the parity test`);
    for (const r of v) names.add(r as string);
  }
  const literal = m[1].match(/"([a-z_]+)"/g) ?? [];
  for (const l of literal) names.add(l.slice(1, -1));
  return names.size > 0 ? names : null;
}

/** Guards of every layout from the entry's own folder up to (app). */
function guardsFor(href: string): Array<{ file: string; roles: Set<string> }> {
  const out: Array<{ file: string; roles: Set<string> }> = [];
  let dir = join(APP, href);
  while (dir.length >= APP.length) {
    const layout = join(dir, "layout.tsx");
    if (existsSync(layout)) {
      const g = layoutGuard(layout);
      if (g) out.push({ file: layout, roles: g });
    }
    if (dir === APP) break;
    dir = dirname(dir);
  }
  return out;
}

const entries = [
  ...NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ src: "nav", ...i }))),
  ...PAGE_INDEX.map((p) => ({ src: "search", id: p.id, href: p.href, rolesAllowed: p.rolesAllowed, failClosed: p.failClosed })),
];

describe("nav + search entries carry their destination guard (PR #2461 blocker 1)", () => {
  it.each(entries.map((e) => [`${e.src}:${e.id} ${e.href}`, e] as const))("%s", (_name, e) => {
    const guards = guardsFor(e.href);
    for (const g of guards) {
      expect(e.rolesAllowed, `${e.href} is guarded by ${g.file} but the entry has no rolesAllowed`).toBeDefined();
      const extra = (e.rolesAllowed ?? []).filter((r) => !g.roles.has(r));
      expect(extra, `${e.href} offers roles the layout ${g.file} rejects`).toEqual([]);
    }
  });
});

describe("the reported leaks are closed", () => {
  const employee = { roles: ["employee"], enabledModules: null };
  const hidden = ["projects", "crm", "inspection", "locations", "mapViewer", "mapMonitoring", "audit", "legal", "loyalty", "catalogue", "recommendations", "reports"];

  it("a plain employee is not offered Projects, CRM, Inspection, Audit, Legal, Loyalty, Catalogue, Recommendations, Reports", () => {
    const ids = visibleNavGroups(employee).flatMap((g) => g.items.map((i) => i.id));
    // Locations admits "employee" (LOCATION_VIEW_ROLES), so it stays; the others must go.
    for (const id of hidden.filter((h) => !["locations", "mapViewer", "mapMonitoring"].includes(h))) expect(ids).not.toContain(id);
    expect(ids).toEqual(expect.arrayContaining(["locations", "mapViewer", "mapMonitoring"]));
  });

  it("search does not offer /approvals, /audit or /reports to an employee", () => {
    for (const q of ["approvals", "audit", "reports", "legal", "crm"]) {
      const hrefs = searchPages(q, employee).map((h) => h.entry.href);
      expect(hrefs).not.toContain("/approvals");
      expect(hrefs).not.toContain("/audit");
      expect(hrefs).not.toContain("/reports");
      expect(hrefs).not.toContain("/legal");
      expect(hrefs).not.toContain("/crm");
    }
  });

  it("the roles that the layouts admit do see their entry", () => {
    const cases: Array<[string, string]> = [
      ["crm_user", "crm"], ["audit_officer", "audit"], ["legal_officer", "legal"], ["project_officer", "projects"],
      ["inspector", "inspection"], ["loyalty_user", "loyalty"], ["catalogue_user", "catalogue"],
      ["recommendation_admin", "recommendations"], ["report_user", "reports"], ["workflow_user", "workflow"],
    ];
    for (const [role, id] of cases) {
      const ids = visibleNavGroups({ roles: [role] }).flatMap((g) => g.items.map((i) => i.id));
      expect(ids, `${role} -> ${id}`).toContain(id);
    }
    expect(searchPages("approvals", { roles: ["workflow_user"] }).map((h) => h.entry.href)).toContain("/approvals");
  });

  it("an explicit empty roles claim hides every role-gated entry (all destination guards redirect [])", () => {
    const gated = entries.filter((e) => e.rolesAllowed);
    expect(gated.length).toBeGreaterThan(20);
    for (const e of gated) expect(isNavItemVisible({ moduleKey: null, ...e }, { roles: [] }), `${e.src}:${e.id}`).toBe(false);
    // Unknown roles (null / undefined) keep the advisory show.
    for (const e of gated) expect(isNavItemVisible({ moduleKey: null, ...e }, { roles: null }), `${e.src}:${e.id}`).toBe(true);
  });

  it("Locations is gated on the locations module like its layout (ModuleGate)", () => {
    const loc = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === "locations")!;
    expect(loc.moduleKey).toBe("locations");
    expect(isNavItemVisible(loc, { roles: ["location_user"], enabledModules: ["finance"] })).toBe(false);
    expect(isNavItemVisible(loc, { roles: ["location_user"], enabledModules: ["locations"] })).toBe(true);
  });
});
