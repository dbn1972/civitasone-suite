import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import * as adminRoles from "@/lib/auth/adminRoles";
import { ADMIN_TILES, visibleAdminTiles } from "./adminTiles";

type Msgs = { admin: { sections: Record<string, string>; tiles: Record<string, { title: string; description: string }> } };
const lookup = (m: Msgs) => (key: string) => {
  const parts = key.split(".");
  let cur: unknown = m.admin;
  for (const p of parts) cur = (cur as Record<string, unknown>)[p];
  return cur as string;
};

// GAP-ADMIN-HOME-02
describe("admin hub tiles", () => {
  const hrefs = ADMIN_TILES.map((t) => t.href);

  it("every admin route folder with a page.tsx has a tile (a new route without one fails here)", () => {
    const folders = readdirSync(__dirname, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(__dirname, d.name, "page.tsx")))
      .map((d) => `/admin/${d.name}`);
    expect(folders.length).toBeGreaterThanOrEqual(27);
    expect(folders.filter((f) => !hrefs.includes(f))).toEqual([]);
  });

  it("has no duplicate hrefs / ids", () => {
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(new Set(ADMIN_TILES.map((t) => t.id)).size).toBe(ADMIN_TILES.length);
  });

  it("is grouped by section: every section appears as one consecutive run (LinkTiles groups consecutive tiles)", () => {
    const runs: string[] = [];
    for (const t of ADMIN_TILES) if (runs[runs.length - 1] !== t.section) runs.push(t.section);
    expect(new Set(runs).size).toBe(runs.length);
  });

  it("gives each tile a distinct icon (no all-folder hub)", () => {
    const icons = ADMIN_TILES.map((t) => t.icon);
    expect(icons.every((i) => i !== "📁")).toBe(true);
    expect(new Set(icons).size).toBeGreaterThan(ADMIN_TILES.length - 6);
  });

  it("shows each role only the tiles its destination page admits", () => {
    const t = lookup(en as unknown as Msgs);
    const tenant = visibleAdminTiles(["tenant_admin"], t).map((x) => x.href);
    expect(tenant).toEqual(expect.arrayContaining(["/admin/integrations", "/admin/users", "/admin/roles", "/admin/org", "/admin/role-features", "/admin/settings"]));
    expect(tenant).toContain("/tenant-admin");
    expect(tenant).not.toContain("/admin/tenants");
    expect(tenant).not.toContain("/admin/operators");
    expect(tenant).not.toContain("/admin/gateway-config");
    const platform = visibleAdminTiles(["platform_admin"], t).map((x) => x.href);
    expect(platform).toEqual(expect.arrayContaining(["/admin/tenants", "/admin/gateway-config", "/admin/gateway-routes", "/admin/audit-log", "/admin/bulk-scan"]));
    expect(visibleAdminTiles(["api_admin"], t).map((x) => x.href)).toEqual(["/admin/gateway-routes"]);
    expect(visibleAdminTiles([], t)).toEqual([]);
  });

  it("carries section headings and icons through to NavTile", () => {
    const tiles = visibleAdminTiles(["super_admin"], lookup(en as unknown as Msgs));
    expect(tiles.every((x) => x.section && x.icon)).toBe(true);
  });
});

describe("tile roles are pinned to the destination page gate", () => {
  const roleConsts = adminRoles as unknown as Record<string, readonly string[]>;
  function pageSource(href: string): string {
    const rel = href.startsWith("/admin/") ? join(__dirname, href.slice("/admin/".length)) : join(__dirname, "..", href.slice(1));
    const dir = existsSync(join(rel, "layout.tsx")) && !existsSync(join(rel, "page.tsx")) ? rel : rel;
    return [join(dir, "layout.tsx"), join(dir, "page.tsx")].filter(existsSync).map((f) => readFileSync(f, "utf8")).join("\n");
  }
  it.each(ADMIN_TILES.map((t) => [t.id, t] as const))("%s", (_id, tile) => {
    const src = pageSource(tile.href);
    const gate = /(?:requireAnyRole|sessionHasAnyRole)\(\s*([A-Za-z_]+)/.exec(src)?.[1]
      ?? [...new Set(src.match(/\b[A-Z_]+_ROLES\b/g) ?? [])][0];
    expect(gate, `no role gate found for ${tile.href}`).toBeTruthy();
    // a local literal list (tenant-admin layout) is compared by value
    const literal = /const ALLOWED = (\[[^\]]*\])/.exec(src)?.[1];
    const expected = roleConsts[gate!] ?? (literal ? (JSON.parse(literal) as string[]) : undefined);
    expect(expected, `${gate} is not an exported role list`).toBeDefined();
    expect([...tile.roles].sort()).toEqual([...expected!].sort());
  });
});

// GAP-ADMIN-HOME-03
describe("admin hub copy", () => {
  it("comes from the message catalogue in en and hi, for every tile and section", () => {
    for (const m of [en, hi] as unknown as Msgs[]) {
      for (const tile of ADMIN_TILES) {
        expect(m.admin.tiles[tile.id]?.title, tile.id).toBeTruthy();
        expect(m.admin.tiles[tile.id]?.description, tile.id).toBeTruthy();
        expect(m.admin.sections[tile.section], tile.section).toBeTruthy();
      }
    }
  });

  it("Invoices / Operators copy no longer promises actions the read-only pages lack", () => {
    const t = (en as unknown as Msgs).admin.tiles;
    expect(t.invoices!.description).not.toMatch(/payments/i);
    expect(t.invoices!.description).toMatch(/read-only/i);
    expect(t.operators!.description).not.toMatch(/accounts/i);
    expect(t.operators!.description).toMatch(/2FA/);
  });
});
