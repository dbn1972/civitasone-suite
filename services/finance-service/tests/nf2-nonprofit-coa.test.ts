/**
 * Section 8 NF-2: the nonprofit chart content fed through S4's seeding mechanism (pure; no DB).
 * Govt/commercial byte-identity is pinned by tests/s4-coa-templates.test.ts + fixtures/govt-standard-gl-heads.json (NF-0 golden).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  glHeadsForTemplate, templateGlHeads, coreGlHeads, standardGlHeads, missingStandardHeads, STATEMENT_CLASSES,
} from "../src/modules/gl/standard-heads.js";
import { FUND_HEAD_CODES } from "../src/modules/gl/system-heads.js";
import { FUND_HEADS } from "../src/modules/gl/funds.js";
import { headNatureOf } from "../src/shared/head-nature.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/govt-standard-gl-heads.json", import.meta.url), "utf8"));
const np = () => glHeadsForTemplate("nonprofit");
const by = () => new Map(np().map((h) => [h.code, h]));

describe("NF-2 nonprofit chart", () => {
  it("seeds the expected head set (core + 40 template heads incl. the default bill head)", () => {
    expect(templateGlHeads("nonprofit")).toHaveLength(40);
    const all = np().map((h) => h.code);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(coreGlHeads().length + 40);
  });
  it("key codes are present with the right statement_class", () => {
    const m = by();
    const cls: Record<string, string> = {
      "3000": "equity", "3100": "equity", "3200": "reserve", "3210": "reserve", "3300": "capital_reserve",
      "2350": "non_current_liability", "1550": "asset", "2320": "current_liability", "2330": "current_liability",
      "2340": "current_liability", "4430": "income", "4440": "income", "4450": "income", "5400": "expense",
    };
    for (const [c, k] of Object.entries(cls)) expect(m.get(c)?.statementClass, c).toBe(k);
  });
  it("both capital-grant candidates are seeded (AS-12 policy choice is left to NF-3)", () => {
    const m = by();
    expect(m.get("2350")).toMatchObject({ classification: "liability", name: "Deferred Government Grant (Capital)" });
    expect(m.get("3300")).toMatchObject({ classification: "equity", name: "Capital Grant Fund" });
  });
  it("every head has a valid statement_class consistent with head-nature; no template code clashes with a core code", () => {
    const core = new Set(coreGlHeads().map((h) => h.code));
    for (const h of np()) {
      expect(STATEMENT_CLASSES as readonly string[]).toContain(h.statementClass);
      const n = headNatureOf(h.code, h.classification);
      const ok = n === "liability" ? ["current_liability", "non_current_liability"].includes(h.statementClass!)
        : n === "equity" ? ["equity", "reserve", "capital_reserve"].includes(h.statementClass!) : h.statementClass === n;
      expect(ok, `${h.code} ${h.classification} ${h.statementClass}`).toBe(true);
    }
    for (const h of templateGlHeads("nonprofit")) expect(core.has(h.code), h.code).toBe(false);
  });
  it("seeds every inter-fund head NF-1 posts to (transfer / release no longer fail closed FUND_HEADS_MISSING)", () => {
    const have = new Set(np().map((h) => h.code));
    expect(Object.keys(FUND_HEADS).sort()).toEqual(["dueFrom", "dueTo", "releaseIn", "releaseOut", "transferIn", "transferOut"]);
    for (const c of Object.values(FUND_HEADS)) expect(have.has(c), c).toBe(true);
    expect(FUND_HEADS).toEqual(FUND_HEAD_CODES());
    const m = by();
    expect(m.get(FUND_HEADS.dueTo)?.statementClass).toBe("current_liability");
    expect(m.get(FUND_HEADS.dueFrom)?.statementClass).toBe("asset");
    for (const c of [FUND_HEADS.transferOut, FUND_HEADS.transferIn, FUND_HEADS.releaseOut, FUND_HEADS.releaseIn]) expect(m.get(c)?.statementClass).toBe("equity");
  });
  it("missingStandardHeads('nonprofit') on an empty chart is the full list", () => {
    expect(missingStandardHeads([], "nonprofit").map((h) => h.code)).toEqual(np().map((h) => h.code));
  });
});

describe("NF-2 does not move govt / commercial", () => {
  it("govt standard list still equals the origin/main fixture (byte-identical, no inter-fund heads)", () => {
    expect(JSON.stringify(standardGlHeads())).toBe(JSON.stringify(fixture.standard));
    const g = new Set(standardGlHeads().map((h) => h.code));
    for (const c of Object.values(FUND_HEADS)) expect(g.has(c)).toBe(false);
  });
  it("commercial gets no inter-fund or capital-grant heads", () => {
    const c = new Set(glHeadsForTemplate("commercial").map((h) => h.code));
    for (const k of [...Object.values(FUND_HEADS), "2350", "3300"]) expect(c.has(k), k).toBe(false);
  });
});
