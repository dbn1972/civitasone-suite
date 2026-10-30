import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

/** Medical insurance card / HR form copy: every en key exists in hi with the same ICU placeholders. */
type Tree = { [k: string]: string | Tree };
function flatten(t: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    if (typeof v === "string") out[`${prefix}${k}`] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
  }
  return out;
}
const placeholders = (v: string) => (v.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(",");

describe("medicalInsurance namespace en/hi parity", () => {
  const e = flatten((en as unknown as Record<string, Tree>).medicalInsurance ?? {});
  const h = flatten((hi as unknown as Record<string, Tree>).medicalInsurance ?? {});

  it("exists in both locales", () => {
    expect(Object.keys(e).length).toBeGreaterThan(0);
    expect(Object.keys(h).length).toBeGreaterThan(0);
  });

  it("hi has every en key, with the same placeholders", () => {
    expect(Object.keys(e).filter((k) => !(k in h))).toEqual([]);
    for (const [k, v] of Object.entries(e)) expect(placeholders(h[k] ?? ""), k).toBe(placeholders(v));
  });

  it("the self-service card title exists in both", () => {
    expect(en.medicalClaims.myInsuranceTitle).toBeTruthy();
    expect(hi.medicalClaims.myInsuranceTitle).toBeTruthy();
  });
});
