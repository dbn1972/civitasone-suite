import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

type Tree = { [k: string]: string | Tree };
const NS = "platformIntegrations";
const enNs = (en as unknown as Record<string, Tree>)[NS] as Tree;
const hiNs = (hi as unknown as Record<string, Tree>)[NS] as Tree;

function flatten(t: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v; else Object.assign(out, flatten(v, key));
  }
  return out;
}
const enFlat = flatten(enNs);
const hiFlat = flatten(hiNs);
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

const SRC = join(__dirname, "..", "..", "app", "(app)", "admin");
const DIRS = [join(SRC, "integrations", "platform", "_components"), join(SRC, "platform", "integrations", "_components")];

function sources(): string[] {
  return DIRS.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx")).map((f) => readFileSync(join(d, f), "utf8")));
}

describe("platformIntegrations messages", () => {
  it("every statically referenced key exists in en and hi", () => {
    const used = new Set<string>();
    for (const src of sources()) for (const m of src.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)) used.add(m[1] as string);
    expect(used.size).toBeGreaterThan(50);
    const missingEn = [...used].filter((k) => !(k in enFlat));
    const missingHi = [...used].filter((k) => !(k in hiFlat));
    expect(missingEn).toEqual([]);
    expect(missingHi).toEqual([]);
  });

  it("dynamically built keys resolve for every value they can take", () => {
    const groups: Record<string, string[]> = {
      categories: ["esign", "dsc", "bank_api", "pfms"],
      categoryHelp: ["esign", "dsc", "bank_api", "pfms"],
      categoryNoun: ["esign", "dsc", "bank_api", "pfms"],
      status: ["available", "beta", "disabled"],
      env: ["sandbox", "production"],
      health: ["untested", "success", "failure"],
      editions: ["govt_dept", "psu", "small_office"],
      fieldType: ["text", "number", "url", "select", "boolean", "multiline", "keyRef"],
      "platform.drawer.tabs": ["overview", "fields", "availability"],
    };
    for (const [group, values] of Object.entries(groups)) {
      for (const v of values) {
        expect(enFlat[`${group}.${v}`], `en ${group}.${v}`).toBeTruthy();
        expect(hiFlat[`${group}.${v}`], `hi ${group}.${v}`).toBeTruthy();
      }
    }
  });

  it("hi has exactly the keys of en, with matching placeholders", () => {
    expect(Object.keys(hiFlat).sort()).toEqual(Object.keys(enFlat).sort());
    for (const k of Object.keys(enFlat)) expect(placeholders(hiFlat[k] as string), k).toEqual(placeholders(enFlat[k] as string));
  });

  it("the two new admin tiles are translated", () => {
    for (const msgs of [en, hi]) {
      const tiles = (msgs as unknown as { admin: { tiles: Record<string, { title: string; description: string }> } }).admin.tiles;
      for (const id of ["platformIntegrations", "tenantIntegrations"]) {
        expect(tiles[id]?.title).toBeTruthy();
        expect(tiles[id]?.description).toBeTruthy();
      }
    }
  });
});
