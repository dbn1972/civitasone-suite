/** The plan pricing page copy (planPricing namespace + admin tile) exists in en and hi with the same keys, none empty. */
import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

type Tree = { [k: string]: string | Tree };
const flat = (o: Tree, p = ""): Record<string, string> =>
  Object.entries(o).reduce<Record<string, string>>((a, [k, v]) => (typeof v === "string" ? { ...a, [p + k]: v } : { ...a, ...flat(v, `${p}${k}.`) }), {});
const pick = (m: unknown) => ({ ...flat({ planPricing: (m as Tree).planPricing as Tree }), ...flat({ tile: ((m as Tree).admin as Tree & { tiles: Tree }).tiles.planPricing as Tree }) });

describe("planPricing catalogue parity", () => {
  it("has the same keys in en and hi, all non-empty, and Hindi is actually Hindi", () => {
    const e = pick(en);
    const h = pick(hi);
    expect(Object.keys(e).length).toBeGreaterThan(10);
    expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
    for (const [k, v] of Object.entries(h)) {
      expect(v.trim(), k).toBeTruthy();
      expect(/[ऀ-ॿ]/.test(v), k).toBe(true);
    }
  });
});
