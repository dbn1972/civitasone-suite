import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";
import { NAV_GROUPS } from "@/lib/nav/navModel";

/**
 * UAT-P3 (H-1): the sidebar and top bar stayed English in Hindi mode although
 * 15 of their labels already had Hindi strings. Every shell label is now in
 * the appNav namespace, en + hi, and this keeps the two files in step.
 */
type Tree = { [k: string]: string | Tree };
const enNav = (en as unknown as { appNav: Tree }).appNav;
const hiNav = (hi as unknown as { appNav: Tree }).appNav;

function leaves(t: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    if (typeof v === "string") out[prefix + k] = v;
    else Object.assign(out, leaves(v, `${prefix}${k}.`));
  }
  return out;
}

describe("appNav messages (sidebar, top bar, search)", () => {
  const e = leaves(enNav);
  const h = leaves(hiNav);

  it("en and hi have exactly the same keys", () => {
    expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
  });

  it("every Hindi string is translated (not a copy of the English)", () => {
    const same = Object.keys(e).filter((k) => h[k] === e[k]);
    expect(same).toEqual([]);
  });

  it("ICU placeholders match between the languages", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(e)) expect(vars(h[k]!), k).toEqual(vars(e[k]!));
  });

  it("covers every sidebar heading and entry", () => {
    for (const g of NAV_GROUPS) {
      expect(e[`group.${g.id}`], g.id).toBeTruthy();
      for (const i of g.items) {
        if (i.id === "dashboard") continue; // nav.dashboard, shared with the page title
        expect(e[`item.${i.id}`], i.id).toBeTruthy();
      }
    }
  });

  it("keeps the 15+ labels that already had Hindi strings in nav.*", () => {
    const nav = (hi as unknown as { nav: Record<string, string> }).nav;
    expect(Object.keys(nav).length).toBeGreaterThanOrEqual(15);
    expect(nav.dashboard).toBe("डैशबोर्ड");
  });
});
