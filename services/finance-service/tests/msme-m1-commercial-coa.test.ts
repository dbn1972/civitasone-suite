/**
 * MSME commercial M1 (pure, no DB): the required-commercial-head set is exactly what the commercial seed provides, the
 * fail-closed check works by CLASSIFICATION, the commercial default bill head comes from the stored template (not the env var),
 * and the collision guard aborts on a different-purpose head. govt output is unchanged.
 */
import { describe, it, expect } from "vitest";
import {
  glHeadsForTemplate, standardGlHeads, coreGlHeads, assertNoTemplateCollision, CoaTemplateCollisionError,
} from "../src/modules/gl/standard-heads.js";
import { REQUIRED_COMMERCIAL_HEADS, commercialChartProblems, COA_INCOMPLETE_CODE } from "../src/modules/gl/commercial-chart.js";
import { billHeadCodeFor, grnBillHeadCode } from "../src/modules/gl/system-heads.js";
import { refusalCode } from "../src/modules/gl/refusal.js";
import { headNatureOf } from "../src/shared/head-nature.js";

const core = new Set(coreGlHeads().map((h) => h.code));

describe("M1 required commercial head set", () => {
  it("equals the template-only heads the commercial seed provides, with matching classification-nature", () => {
    const seeded = glHeadsForTemplate("commercial").filter((h) => !core.has(h.code));
    expect(Object.keys(REQUIRED_COMMERCIAL_HEADS).sort()).toEqual(seeded.map((h) => h.code).sort());
    for (const h of seeded) {
      expect(h.classification, h.code).toBe(REQUIRED_COMMERCIAL_HEADS[h.code]);
      expect(h.statementClass, `${h.code} statementClass`).toBeTruthy();
      expect(h.hoaCode, `${h.code} carries no HoA`).toBeUndefined();
      // consistent with the nature rules (1 asset, 2/3 liability|equity, 4 income, 5/6 expense)
      const nature = headNatureOf(h.code, h.classification);
      expect(["asset", "liability", "equity", "income", "expense"]).toContain(nature);
    }
  });
  it("contains the design list: 5400, 1500/1600/1700/1800, 2300/2310/2400/2500, 3000/3200, 4400, 5410-5450, 6200 (+ M3a per-tax GST heads 1701-1705, 2301)", () => {
    expect(Object.keys(REQUIRED_COMMERCIAL_HEADS).sort()).toEqual(
      ["1500", "1600", "1700", "1701", "1702", "1703", "1704", "1705", "1800", "2300", "2301", "2310", "2400", "2500", "3000", "3200", "4400", "5400", "5410", "5420", "5430", "5440", "5450", "6200"]);
  });
  it("govt seed is untouched: no statementClass on any govt row, no commercial-only code leaks in", () => {
    for (const h of standardGlHeads()) {
      expect(h.statementClass).toBeUndefined();
      if (!core.has(h.code)) expect(["2202"]).toContain(h.code);
    }
  });
});

describe("M1 fail-closed by classification (not code existence)", () => {
  const full = Object.entries(REQUIRED_COMMERCIAL_HEADS).map(([code, classification]) => ({ code, classification }));
  it("a complete chart has no problems", () => expect(commercialChartProblems(full)).toEqual([]));
  it("a missing code is a problem", () => expect(commercialChartProblems(full.filter((h) => h.code !== "1700"))).toEqual(["1700 missing"]));
  it("a code that EXISTS under a different classification is a problem (govt tenant reusing 3000)", () => {
    const wrong = full.map((h) => (h.code === "3000" ? { code: "3000", classification: "expense" } : h));
    expect(commercialChartProblems(wrong)).toEqual(["3000 is expense, expected equity"]);
  });
  it("the refusal carries a code the journal-rejection path recognises", () => {
    expect(refusalCode({ code: COA_INCOMPLETE_CODE, message: "x" })).toBe(COA_INCOMPLETE_CODE);
  });
});

describe("M1 default bill head comes from settings for commercial, not the env var", () => {
  it("commercial ignores the env override; govt and nonprofit keep honouring it", () => {
    expect(billHeadCodeFor("commercial", "2202")).toBe("5400");
    expect(billHeadCodeFor("commercial", undefined)).toBe("5400");
    expect(billHeadCodeFor("govt", undefined)).toBe("2202");
    expect(billHeadCodeFor("govt", "9999")).toBe("9999");
    expect(billHeadCodeFor("nonprofit", " 6001 ")).toBe("6001");
  });
  it("grnBillHeadCode(commercial) is 5400 even with the global env set to a govt head", () => {
    const saved = process.env.FINANCE_GRN_BILL_HEAD_CODE;
    process.env.FINANCE_GRN_BILL_HEAD_CODE = "2202";
    try {
      expect(grnBillHeadCode("commercial")).toBe("5400");
      expect(grnBillHeadCode("govt")).toBe("2202");
      expect(glHeadsForTemplate("commercial").some((h) => h.code === "2202")).toBe(false);
    } finally { if (saved === undefined) delete process.env.FINANCE_GRN_BILL_HEAD_CODE; else process.env.FINANCE_GRN_BILL_HEAD_CODE = saved; }
  });
});

describe("M1 collision guard", () => {
  it("aborts when a tenant already uses a commercial code for a different purpose", () => {
    expect(() => assertNoTemplateCollision([{ code: "3000", classification: "expense" }], "commercial")).toThrow(CoaTemplateCollisionError);
    expect(() => assertNoTemplateCollision([{ code: "2300", classification: "liability" }], "commercial")).not.toThrow();
  });
});
