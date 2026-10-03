import { describe, it, expect } from "vitest";
import { mapDemandDetail, mapMajorHeads } from "./demandDetail";

describe("mapDemandDetail (GAP-FINANCE-BUDGET-DEMAND-GRANTS-04)", () => {
  const base = { id: "d1", demandNo: "D-01", service: "Education", amountMinor: "100000", class: "voted", status: "draft" };
  it("maps the demand and its head-wise lines with the reconciliation flag", () => {
    const d = mapDemandDetail({ data: { ...base, linesTotalMinor: "100000", linesReconciled: true, lines: [{ id: "l1", headCode: "2202", headName: "General Education", amountMinor: "100000" }] } });
    expect(d).toMatchObject({ demandNo: "D-01", linesTotalMinor: "100000", linesReconciled: true });
    expect(d?.lines).toEqual([{ id: "l1", headCode: "2202", headName: "General Education", amountMinor: "100000" }]);
  });
  it("a demand with no lines yet is unreconciled, not a failure", () => {
    expect(mapDemandDetail({ data: base })).toMatchObject({ lines: [], linesReconciled: false, linesTotalMinor: "0" });
  });
  it("returns null for a payload that is not a demand", () => {
    expect(mapDemandDetail({ data: { id: "d1" } })).toBeNull();
    expect(mapDemandDetail(null)).toBeNull();
  });
});

describe("mapMajorHeads", () => {
  it("keeps only level-0 (major) heads", () => {
    const out = mapMajorHeads({ data: [
      { code: "2202", name: "General Education", level: 0 },
      { code: "2202-01", name: "Elementary", level: 1 },
    ] });
    expect(out).toEqual([{ code: "2202", name: "General Education" }]);
  });
  it("returns null when the payload has no rows array", () => {
    expect(mapMajorHeads({})).toBeNull();
  });
});
