import { describe, it, expect } from "vitest";
import { blankDraft, checkSlabDrafts, draftFromSlab, effectiveDateIssue, isBackDated, slabGaps } from "./slabDrafts";

import type { PtGender } from "./constants";

const d = (from: string, to: string, tax: string, feb = "", gender: PtGender = "all") => ({ from, to, tax, feb, gender });

describe("checkSlabDrafts", () => {
  it("parses rupees to paise and a blank 'to' to the open-ended sentinel", () => {
    const r = checkSlabDrafts([d("0", "15000", "0"), d("15000.01", "", "200", "300")]);
    expect(r).toEqual({
      ok: true,
      slabs: [
        { fromMinor: 0, toMinor: 1500000, taxMinor: 0, februaryTaxMinor: null, appliesToGender: "all" },
        { fromMinor: 1500001, toMinor: 999999999999, taxMinor: 20000, februaryTaxMinor: 30000, appliesToGender: "all" },
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
    expect(draftFromSlab({ fromMinor: 1500001, toMinor: 999999999999, taxMinor: 20000, februaryTaxMinor: 30050, appliesToGender: "female" })).toEqual({ from: "15000.01", to: "", tax: "200", feb: "300.50", gender: "female" });
    expect(blankDraft()).toEqual({ from: "", to: "", tax: "", feb: "", gender: "all" });
  });
});

const s = (fromMinor: number, toMinor: number, appliesToGender: PtGender = "all") => ({ fromMinor, toMinor, taxMinor: 0, februaryTaxMinor: null, appliesToGender });

describe("slabGaps / dates", () => {
  it("reports uncovered ranges between slabs", () => {
    expect(slabGaps([s(0, 100), s(500, 900)])).toEqual([{ fromMinor: 101, toMinor: 499 }]);
    expect(slabGaps([s(0, 100), s(101, 900)])).toEqual([]);
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

describe("gender slabs", () => {
  it("carries the gender into the payload", () => {
    expect(checkSlabDrafts([d("0", "", "0", "", "female"), d("0", "", "200")])).toEqual({
      ok: true,
      slabs: [
        { fromMinor: 0, toMinor: 999999999999, taxMinor: 0, februaryTaxMinor: null, appliesToGender: "female" },
        { fromMinor: 0, toMinor: 999999999999, taxMinor: 20000, februaryTaxMinor: null, appliesToGender: "all" },
      ],
    });
  });
  it("overlap is checked per gender group", () => {
    // the same range under different genders is fine
    expect(checkSlabDrafts([d("0", "100", "1"), d("0", "100", "0", "", "female"), d("0", "100", "0", "", "male")])).toMatchObject({ ok: true });
    // two female slabs overlapping are not, and the later row is flagged
    expect(checkSlabDrafts([d("0", "100", "1"), d("0", "100", "0", "", "female"), d("50", "200", "0", "", "female")])).toMatchObject({ ok: false, issue: "overlap", row: 2 });
    // an "all" slab overlapping a female one is fine, but two "all" slabs are not
    expect(checkSlabDrafts([d("0", "100", "1"), d("50", "200", "1", "", "female")])).toMatchObject({ ok: true });
    expect(checkSlabDrafts([d("0", "100", "1", "", "male"), d("100", "200", "1", "", "male")])).toMatchObject({ ok: false, issue: "overlap", row: 1 });
  });
  it("gaps are judged on the all-employees slabs only", () => {
    expect(slabGaps([s(0, 100), s(500, 900), s(101, 499, "female")])).toEqual([{ fromMinor: 101, toMinor: 499 }]);
  });
});
