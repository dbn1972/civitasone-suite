/**
 * C24 / GAP-FINANCE-DASHBOARD-01: the category split is by MAJOR HEAD OF ACCOUNT over the same set as totalExpenditure.
 */
import { describe, it, expect } from "vitest";
import { buildCategoryBreakdown, UNCLASSIFIED_MAJOR_HEAD_LABEL } from "../src/modules/dashboard/queries.js";

const NAMES = new Map([["2202", "General Education"], ["2210", "Medical and Public Health"]]);
const sum = (rows: Array<{ amountMinor: string }>) => rows.reduce((s, r) => s + BigInt(r.amountMinor), 0n);

describe("buildCategoryBreakdown", () => {
  it("rolls heads up to their 4-digit major head, largest first, labelled with the master description", () => {
    const perHead = [
      { hoaCode: "2202-01-101-00-00-00", netMinor: 1_500_000n },
      { hoaCode: "2202-02-109-00-00-00", netMinor: 2_500_000n },
      { hoaCode: "2210-03-103-00-00-00", netMinor: 9_000_000n },
    ];
    const out = buildCategoryBreakdown(perHead, NAMES)!;
    expect(out).toEqual([
      { label: "2210 - Medical and Public Health", amountMinor: "9000000" },
      { label: "2202 - General Education", amountMinor: "4000000" },
    ]);
    // reconciles with totalExpenditure (the sum of the same per-head set)
    expect(sum(out)).toBe(perHead.reduce((s, h) => s + h.netMinor, 0n));
  });
  it("a head with no usable HoA lands in one Unclassified bucket, so the split still adds up", () => {
    const perHead = [
      { hoaCode: null, netMinor: 700n },
      { hoaCode: "", netMinor: 300n },
      { hoaCode: "bad", netMinor: 50n },
      { hoaCode: "4059-80-051-00-00-00", netMinor: 5_000n },
    ];
    const out = buildCategoryBreakdown(perHead, NAMES)!;
    expect(out.find((r) => r.label === UNCLASSIFIED_MAJOR_HEAD_LABEL)?.amountMinor).toBe("1050");
    expect(out.find((r) => r.label === "4059")?.amountMinor).toBe("5000"); // major head not in the master: bare code
    expect(sum(out)).toBe(6_050n);
  });
  it("is omitted (never faked) when there is nothing to split or a bucket nets negative", () => {
    expect(buildCategoryBreakdown([], NAMES)).toBeUndefined();
    expect(buildCategoryBreakdown([{ hoaCode: "2202-01-101-00-00-00", netMinor: 0n }], NAMES)).toBeUndefined();
    expect(buildCategoryBreakdown([{ hoaCode: "2202-01-101-00-00-00", netMinor: -10n }, { hoaCode: "2210-01-101-00-00-00", netMinor: 50n }], NAMES)).toBeUndefined();
  });
  it("keeps amounts beyond 2^53 paise exact", () => {
    const big = 9_007_199_254_740_993n;
    expect(buildCategoryBreakdown([{ hoaCode: "2202-01-101-00-00-00", netMinor: big }], NAMES)![0]!.amountMinor).toBe("9007199254740993");
  });
});
