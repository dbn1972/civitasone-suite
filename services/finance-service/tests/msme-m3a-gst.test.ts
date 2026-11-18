/**
 * MSME M3a (pure, no DB): the ITC posting builder, validation, CA-flagged config defaults, and the per-tax head definitions.
 */
import { describe, it, expect, afterEach } from "vitest";
import { buildBillGstPosting, validateBillGst, expectedTaxMinor, resolveItcCategory, billGstInput, rcmCategories, blockedItcCategories, type BillGstInput } from "../src/modules/gst/itc.js";
import { GST_HEADS, GST_ITC_HEAD_CODE, RCM_ITC_PENDING_CODE, RCM_PAYABLE_CODE } from "../src/modules/gl/gst-heads.js";
import { REQUIRED_COMMERCIAL_HEADS } from "../src/modules/gl/commercial-chart.js";
import { glHeadsForTemplate, coreGlHeads, standardGlHeads } from "../src/modules/gl/standard-heads.js";
import { isValidGstRate } from "../src/modules/gst/gst-rates.js";

const SLABS_2026 = [0, 0.25, 3, 5, 18, 40];
const parse = (o: unknown): BillGstInput => billGstInput.parse(o);
const cgstSgst = (rate: number, taxable: number, tax: number) => [
  { gstType: "CGST", ratePct: rate, taxableMinor: taxable, taxMinor: tax }, { gstType: "SGST", ratePct: rate, taxableMinor: taxable, taxMinor: tax },
];
afterEach(() => { delete process.env.FINANCE_GST_RCM_CATEGORIES; delete process.env.FINANCE_GST_ITC_BLOCKED_CATEGORIES; });

describe("per-tax ITC heads", () => {
  it("are commercial-template only, distinct, required fail-closed, and absent from govt", () => {
    const codes = GST_HEADS.map((h) => h.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(["1701", "1702", "1703", "1704", "1705", "2301"]);
    const com = glHeadsForTemplate("commercial");
    for (const h of GST_HEADS) {
      expect(com.find((x) => x.code === h.code)?.classification, h.code).toBe(h.classification);
      expect(REQUIRED_COMMERCIAL_HEADS[h.code], h.code).toBe(h.classification);
      expect(coreGlHeads().some((c) => c.code === h.code), `${h.code} not core`).toBe(false);
      expect(standardGlHeads().some((c) => c.code === h.code), `${h.code} not govt`).toBe(false);
      expect(glHeadsForTemplate("nonprofit").some((c) => c.code === h.code), `${h.code} not nonprofit`).toBe(false);
    }
  });
});

describe("builder: normal bill (tax inside net)", () => {
  it("Dr purchases (net - eligible tax), Dr each per-tax ITC head, Cr AP; balanced", () => {
    const g = parse({ rcm: false, lines: cgstSgst(9, 100000, 9000) });
    const { lines, entries } = buildBillGstPosting({ expenseAccount: "EXP", apAccount: "AP", netMinor: 118000n, rcm: false, lines: validateBillGst(g, 118000n, SLABS_2026) });
    expect(lines).toEqual([
      { accountCode: "EXP", debitMinor: 100000n, creditMinor: 0n },
      { accountCode: GST_ITC_HEAD_CODE.CGST, debitMinor: 9000n, creditMinor: 0n, narration: "Input tax credit CGST" },
      { accountCode: GST_ITC_HEAD_CODE.SGST, debitMinor: 9000n, creditMinor: 0n, narration: "Input tax credit SGST" },
      { accountCode: "AP", debitMinor: 0n, creditMinor: 118000n },
    ]);
    expect(lines.reduce((s, l) => s + l.debitMinor - l.creditMinor, 0n)).toBe(0n);
    expect(entries.map((e) => e.glHeadCode)).toEqual(["1702", "1703"]);
  });
  it("ineligible and blocked tax stays in the expense and has no ITC head", () => {
    process.env.FINANCE_GST_ITC_BLOCKED_CATEGORIES = "motor_vehicle";
    const g = parse({ rcm: false, lines: [{ gstType: "IGST", ratePct: 18, taxableMinor: 100000, taxMinor: 18000, blockCategory: "motor_vehicle" }] });
    const { lines, entries } = buildBillGstPosting({ expenseAccount: "EXP", apAccount: "AP", netMinor: 118000n, rcm: false, lines: validateBillGst(g, 118000n, SLABS_2026) });
    expect(lines.map((l) => l.accountCode)).toEqual(["EXP", "AP"]);
    expect(lines[0]!.debitMinor).toBe(118000n);
    expect(entries[0]).toMatchObject({ itcCategory: "blocked", glHeadCode: null });
  });
  it("a configured blocked category overrides a declared 'eligible'; unconfigured leaves the declared category", () => {
    expect(resolveItcCategory({ itcCategory: "eligible", blockCategory: "x" }, new Set(["x"]))).toBe("blocked");
    expect(resolveItcCategory({ itcCategory: "eligible", blockCategory: "x" }, new Set())).toBe("eligible");
    expect(resolveItcCategory({ itcCategory: "ineligible" }, new Set(["x"]))).toBe("ineligible");
  });
});

describe("builder: RCM (three legs)", () => {
  it("Dr expense + Dr ITC-RCM-pending / Cr AP + Cr RCM payable; balanced; non-eligible RCM tax is cost", () => {
    process.env.FINANCE_GST_RCM_CATEGORIES = "goods_transport";
    const g = parse({ rcm: true, rcmCategory: "goods_transport", lines: [{ gstType: "IGST", ratePct: 5, taxableMinor: 100000, taxMinor: 5000 }] });
    const { lines } = buildBillGstPosting({ expenseAccount: "EXP", apAccount: "AP", netMinor: 100000n, rcm: true, lines: validateBillGst(g, 100000n, SLABS_2026) });
    expect(lines.map((l) => [l.accountCode, l.debitMinor, l.creditMinor])).toEqual([
      ["EXP", 100000n, 0n], [RCM_ITC_PENDING_CODE, 5000n, 0n], ["AP", 0n, 100000n], [RCM_PAYABLE_CODE, 0n, 5000n],
    ]);
    const ineligible = parse({ rcm: true, rcmCategory: "goods_transport", lines: [{ gstType: "IGST", ratePct: 5, taxableMinor: 100000, taxMinor: 5000, itcCategory: "ineligible" }] });
    const r2 = buildBillGstPosting({ expenseAccount: "EXP", apAccount: "AP", netMinor: 100000n, rcm: true, lines: validateBillGst(ineligible, 100000n, SLABS_2026) });
    expect(r2.lines.map((l) => [l.accountCode, l.debitMinor, l.creditMinor])).toEqual([["EXP", 105000n, 0n], ["AP", 0n, 100000n], [RCM_PAYABLE_CODE, 0n, 5000n]]);
  });
  it("RCM scope is CA-owned config, EMPTY by default: an RCM bill is refused until a category is configured", () => {
    expect(rcmCategories().size).toBe(0); expect(blockedItcCategories().size).toBe(0);
    const g = parse({ rcm: true, rcmCategory: "goods_transport", lines: [{ gstType: "IGST", ratePct: 5, taxableMinor: 100000, taxMinor: 5000 }] });
    expect(() => validateBillGst(g, 100000n, SLABS_2026)).toThrow(/GST_RCM_CATEGORY_NOT_CONFIGURED/);
    expect(() => validateBillGst(parse({ rcm: true, lines: g.lines }), 100000n, SLABS_2026)).toThrow(/GST_RCM_CATEGORY_REQUIRED/);
  });
});

describe("validation", () => {
  const ok = (lines: unknown, net = 1_000_000n, slabs = SLABS_2026) => validateBillGst(parse({ rcm: false, lines }), net, slabs);
  it("tax must match rate x taxable within 1 paisa; rate must be a slab in force", () => {
    expect(expectedTaxMinor(100000n, 18)).toBe(18000n); expect(expectedTaxMinor(333n, 5)).toBe(17n);
    expect(() => ok([{ gstType: "IGST", ratePct: 18, taxableMinor: 100000, taxMinor: 17000 }])).toThrow(/GST_TAX_MISMATCH/);
    expect(() => ok([{ gstType: "IGST", ratePct: 12, taxableMinor: 100000, taxMinor: 12000 }])).toThrow(/GST_RATE_INVALID/);
    expect(() => ok([{ gstType: "IGST", ratePct: 40, taxableMinor: 100000, taxMinor: 40000 }])).not.toThrow();
    expect(isValidGstRate(12, "IGST", [0, 5, 12, 18, 28])).toBe(true);
  });
  it("shape rules: one line per type+rate; IGST xor CGST+SGST; CGST/SGST paired and equal; tax within the bill", () => {
    const igst = { gstType: "IGST", ratePct: 5, taxableMinor: 100000, taxMinor: 5000 };
    expect(() => ok([igst, igst])).toThrow(/GST_DUPLICATE_LINE/);
    expect(() => ok([igst, ...cgstSgst(2.5, 100000, 2500)])).toThrow(/GST_MIXED_SUPPLY/);
    expect(() => ok([{ gstType: "CGST", ratePct: 9, taxableMinor: 100000, taxMinor: 9000 }])).toThrow(/GST_UNPAIRED/);
    expect(() => ok([{ gstType: "CGST", ratePct: 9, taxableMinor: 100000, taxMinor: 9000 }, { gstType: "SGST", ratePct: 9, taxableMinor: 100000, taxMinor: 8999 }])).toThrow(/GST_CGST_SGST_UNEQUAL/);
    expect(() => ok([igst], 4000n)).toThrow(/GST_TAX_EXCEEDS_BILL/);
  });
  it("malformed GSTIN / non-numeric HSN are rejected at the schema", () => {
    expect(() => parse({ supplierGstin: "BADGSTIN", lines: [{ gstType: "IGST", ratePct: 5, taxableMinor: 1, taxMinor: 0 }] })).toThrow();
    expect(() => parse({ lines: [{ gstType: "IGST", ratePct: 5, taxableMinor: 1, taxMinor: 0, hsnCode: "ABCD" }] })).toThrow();
  });
});
