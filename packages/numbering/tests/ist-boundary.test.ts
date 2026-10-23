/**
 * CLOS2-S6-02: financial year and reset buckets follow the IST calendar
 * (Asia/Kolkata, UTC+05:30), not UTC. 00:00-05:30 IST on the 1st belongs to the
 * new period.
 */
import { describe, it, expect } from "vitest";
import { financialYear, resetBucket, formatReference, DEFAULT_SPEC, type NumberFormatSpec } from "../src/index.js";

const D = (iso: string) => new Date(iso);
const spec = (o: Partial<NumberFormatSpec>): NumberFormatSpec => ({ ...DEFAULT_SPEC, ...o });

describe("financialYear at the IST 1 April boundary", () => {
  it("23:59:59 IST on 31 March is still the old FY", () => {
    expect(financialYear(D("2026-03-31T18:29:59Z"), 4)).toBe("2025-26");
  });
  it("00:00:00 IST on 1 April is the new FY", () => {
    expect(financialYear(D("2026-03-31T18:30:00Z"), 4)).toBe("2026-27");
  });
  it("02:00 IST on 1 April is the new FY", () => {
    expect(financialYear(D("2026-03-31T20:30:00Z"), 4)).toBe("2026-27");
  });
  it("05:30 IST on 1 April is the new FY", () => {
    expect(financialYear(D("2026-04-01T00:00:00Z"), 4)).toBe("2026-27");
  });
  it("formatReference embeds the IST financial year", () => {
    expect(
      formatReference(spec({ prefix: "PO", embedFinancialYear: true, fyStartMonth: 4 }), 1, { at: D("2026-03-31T20:30:00Z") }),
    ).toContain("2026-27");
  });
});

describe("resetBucket at the IST boundary", () => {
  it("monthly rolls at 00:00 IST on the 1st", () => {
    expect(resetBucket(spec({ resetPolicy: "monthly" }), D("2026-06-30T18:29:59Z"))).toBe("2026-06");
    expect(resetBucket(spec({ resetPolicy: "monthly" }), D("2026-06-30T18:30:00Z"))).toBe("2026-07");
  });
  it("yearly calendar bucket rolls at 00:00 IST on 1 January", () => {
    const s = spec({ resetPolicy: "yearly", embedFinancialYear: false });
    expect(resetBucket(s, D("2025-12-31T18:29:59Z"))).toBe("2025");
    expect(resetBucket(s, D("2025-12-31T18:30:00Z"))).toBe("2026");
  });
  it("yearly FY bucket rolls at 00:00 IST on 1 April", () => {
    const s = spec({ resetPolicy: "yearly", embedFinancialYear: true, fyStartMonth: 4 });
    expect(resetBucket(s, D("2026-03-31T18:29:59Z"))).toBe("2025-26");
    expect(resetBucket(s, D("2026-03-31T18:30:00Z"))).toBe("2026-27");
  });
});
