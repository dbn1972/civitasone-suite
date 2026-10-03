import { describe, it, expect } from "vitest";
import { blankDraft, checkSlabDrafts, draftFromSlab, effectiveDateIssue, isBackDated, slabGaps } from "./slabDrafts";

const d = (from: string, to: string, tax: string, feb = "") => ({ from, to, tax, feb });

describe("checkSlabDrafts", () => {
  it("parses rupees to paise and a blank 'to' to the open-ended sentinel", () => {
    const r = checkSlabDrafts([d("0", "15000", "0"), d("15000.01", "", "200", "300")]);
    expect(r).toEqual({
      ok: true,
      slabs: [
        { fromMinor: 0, toMinor: 1500000, taxMinor: 0, februaryTaxMinor: null },
        { fromMinor: 1500001, toMinor: 999999999999, taxMinor: 20000, februaryTaxMinor: 30000 },
      ],
    });
  });
  it("names the offending row and field", () => {
    expect(checkSlabDrafts([d("x", "", "1")])).toMatchObject({ ok: false, issue: "from", row: 0, field: "from" });
    expect(checkSlabDrafts([d("0", "abc", "1")])).toMatchObject({ ok: false, issue: "to", field: "to" });
    expect(checkSlabDrafts([d("100", "50", "1")])).toMatchObject({ ok: false, issue: "range", field: "to" });
    expect(checkSlabDrafts([d("0", "10", "")])).toMatchObject({ ok: false, issue: "tax", field: "tax" });
    expect(checkSlabDrafts([d("0", "10", "5", "zz")])).toMatchObject({ ok: false, issue: "feb", field: "feb" });
    expect(checkSlabDrafts([])).toMatchObject({ ok: false, issue: "none" });
  });
  it("refuses a month above the Article 276(2) cap (Rs 2,500), allows exactly Rs 2,500", () => {
    expect(checkSlabDrafts([d("0", "", "2500.01")])).toMatchObject({ ok: false, issue: "cap", field: "tax" });
    expect(checkSlabDrafts([d("0", "", "10", "2500.01")])).toMatchObject({ ok: false, issue: "cap", field: "feb" });
    expect(checkSlabDrafts([d("0", "", "2500")])).toMatchObject({ ok: true });
  });
  it("flags overlapping (inclusive) and same-start slabs on the later row, whatever the entry order", () => {
    expect(checkSlabDrafts([d("0", "100", "1"), d("100", "200", "1")])).toMatchObject({ ok: false, issue: "overlap", row: 1 });
    expect(checkSlabDrafts([d("101", "200", "1"), d("0", "100", "1")])).toMatchObject({ ok: true });
    expect(checkSlabDrafts([d("0", "100", "1"), d("0", "300", "1")])).toMatchObject({ ok: false, issue: "overlap" });
  });
});

describe("draftFromSlab / blankDraft", () => {
  it("round-trips a slab into editable rupee text", () => {
    expect(draftFromSlab({ fromMinor: 1500001, toMinor: 999999999999, taxMinor: 20000, februaryTaxMinor: 30050 })).toEqual({ from: "15000.01", to: "", tax: "200", feb: "300.50" });
    expect(blankDraft()).toEqual({ from: "", to: "", tax: "", feb: "" });
  });
});

describe("slabGaps / dates", () => {
  it("reports uncovered ranges between slabs", () => {
    expect(slabGaps([{ fromMinor: 0, toMinor: 100, taxMinor: 0, februaryTaxMinor: null }, { fromMinor: 500, toMinor: 900, taxMinor: 1, februaryTaxMinor: null }])).toEqual([{ fromMinor: 101, toMinor: 499 }]);
    expect(slabGaps([{ fromMinor: 0, toMinor: 100, taxMinor: 0, februaryTaxMinor: null }, { fromMinor: 101, toMinor: 900, taxMinor: 1, februaryTaxMinor: null }])).toEqual([]);
  });
  it("effective date: required, not before the earliest allowed; back-dated when before today", () => {
    expect(effectiveDateIssue("", null)).toBe("required");
    expect(effectiveDateIssue("2026-08-31", "2026-09-01")).toBe("tooEarly");
    expect(effectiveDateIssue("2026-09-01", "2026-09-01")).toBeNull();
    expect(effectiveDateIssue("2020-01-01", null)).toBeNull();
    expect(isBackDated("2026-10-02", "2026-10-03")).toBe(true);
    expect(isBackDated("2026-10-03", "2026-10-03")).toBe(false);
  });
});
