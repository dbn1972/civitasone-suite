import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import { CRM_ADMIN_ROLES, CRM_STRICT_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { CRM_HUB_SECTIONS, canSeeTile, visibleHubSections, type TileAccess } from "./hubTiles";

const CRM_DIR = __dirname;
const allTiles = CRM_HUB_SECTIONS.flatMap((s) => s.tiles);
const dirOf = (href: string) => path.join(CRM_DIR, href.replace(/^\/crm\/?/, ""));

type Messages = Record<string, unknown>;
function lookup(messages: Messages, ns: string, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of ns.split(".")) node = (node as Messages | undefined)?.[part];
  const v = (node as Messages | undefined)?.[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Every title a destination page can render in its <PageHeader>: a string
 * literal, a {"literal"}, or t("key") resolved against the namespace the page
 * bound that translator to (getTranslations / useTranslations).
 */
function pageHeaderTitles(source: string, messages: Messages): string[] {
  const bound = new Map<string, string>();
  for (const m of source.matchAll(/const (\w+) = (?:await )?(?:getTranslations|useTranslations)\("([^"]+)"\)/g)) {
    bound.set(m[1]!, m[2]!);
  }
  const titles: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf("<PageHeader", from);
    if (at < 0) break;
    from = at + 1;
    const m = /\stitle=(?:"([^"]+)"|\{\s*"([^"]+)"\s*\}|\{\s*(\w+)\("([\w.]+)"\)\s*\})/.exec(source.slice(at, at + 1200));
    if (!m) continue;
    if (m[1] ?? m[2]) titles.push((m[1] ?? m[2])!);
    else {
      const ns = bound.get(m[3]!);
      const resolved = ns ? lookup(messages, ns, m[4]!) : undefined;
      if (resolved) titles.push(resolved);
    }
  }
  return titles;
}

describe("CRM hub tile access mirrors the destination route guards (GAP-CRM-HOME-01)", () => {
  function guardOf(href: string): TileAccess {
    const layout = path.join(dirOf(href), "layout.tsx");
    if (!existsSync(layout)) return "all";
    const src = readFileSync(layout, "utf8");
    // One source of truth: no layout may keep its own copy of an admin role list.
    expect(src, `${href}/layout.tsx must not declare a local role array`).not.toMatch(/^\s*(?:export\s+)?const\s+\w*ROLES\s*=\s*\[/m);
    if (/requireAnyRole\(\s*CRM_STRICT_ADMIN_ROLES\b/.test(src)) return "strictAdmin";
    if (/requireAnyRole\(\s*CRM_ADMIN_ROLES\b/.test(src)) return "admin";
    return "all";
  }

  it.each(allTiles.map((t) => [t.href, t.access] as const))("%s tile is %s, like its layout guard", (href, access) => {
    expect(guardOf(href)).toBe(access);
  });

  it("lists the Configuration section as 12 tiles for a crm_admin and only the open ones for a crm_user", () => {
    const configFor = (roles: string[]) =>
      visibleHubSections(roles).find((s) => s.sectionKey === "configuration")?.tiles.map((t) => t.tileKey) ?? [];
    expect(configFor(["crm_admin"])).toHaveLength(12);
    expect(configFor(["crm_user"])).toEqual(["linkedAccounts", "dataQuality"]);
  });

  it("never offers a crm_user a tile whose destination gate they fail", () => {
    const shown = visibleHubSections(["crm_user"]).flatMap((s) => s.tiles);
    for (const tile of shown) expect(tile.access).toBe("all");
    const hidden = allTiles.filter((t) => !shown.includes(t)).map((t) => t.tileKey);
    // The ten Configuration routes the finding names, plus the other admin-only layouts.
    expect(hidden).toEqual(
      expect.arrayContaining([
        "customFields", "dedupRules", "leadScoring", "qualificationFrameworks", "leadReasonCodes",
        "assignmentRules", "assignmentDirectory", "escalationRules", "taskEscalation", "documentTypes",
        "agentWorkload", "pipelines", "leadForms", "products", "serviceTypes", "grievanceCategories",
      ]),
    );
  });

  it("admits `admin` to CRM-admin tiles but not to the three route-accurate tiles", () => {
    expect(canSeeTile("admin", ["admin"])).toBe(true);
    expect(canSeeTile("strictAdmin", ["admin"])).toBe(false);
    expect(canSeeTile("strictAdmin", ["crm_admin"])).toBe(true);
    expect(CRM_STRICT_ADMIN_ROLES.every((r) => CRM_ADMIN_ROLES.includes(r))).toBe(true);
  });

  it("drops a section that has no visible tile instead of rendering an empty heading", () => {
    expect(visibleHubSections(["crm_user"]).every((s) => s.tiles.length > 0)).toBe(true);
  });
});

describe("CRM hub tile titles equal the destination page titles (GAP-CRM-HOME-02)", () => {
  const tiles = (en as unknown as { crm: { hub: { tiles: Record<string, { title: string }> } } }).crm.hub.tiles;

  it.each(allTiles.map((t) => [t.href, t.tileKey] as const))("%s", (href, tileKey) => {
    const page = path.join(dirOf(href), "page.tsx");
    const titles = pageHeaderTitles(readFileSync(page, "utf8"), en as unknown as Messages);
    expect(titles.length, `${href}: no resolvable <PageHeader title>`).toBeGreaterThan(0);
    expect(titles).toContain(tiles[tileKey]!.title);
  });

  it("uses no 'Sales' wording in any hub tile or section title", () => {
    const hub = (en as unknown as { crm: { hub: Messages } }).crm.hub;
    expect(JSON.stringify([hub.sections, Object.values(tiles).map((t) => t.title)])).not.toMatch(/sales/i);
  });

  it("has a Hindi title for every tile", () => {
    const hiTiles = (hi as unknown as { crm: { hub: { tiles: Record<string, { title: string }> } } }).crm.hub.tiles;
    for (const tile of allTiles) expect(hiTiles[tile.tileKey]?.title, tile.tileKey).toBeTruthy();
  });
});
