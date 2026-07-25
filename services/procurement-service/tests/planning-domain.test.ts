import { describe, it, expect } from "vitest";
import {
  aggregateDemand, planTotalMinor, assertTransitionAllowed,
  assertDistinctMakerChecker, assertPlanApprovedForLinkage, DomainError,
  type DemandInput,
} from "../src/modules/planning/domain.js";

describe("SVC-041 planning domain — demand aggregation", () => {
  it("sums quantity and value for same item/category/budget/quarter", () => {
    const rows: DemandInput[] = [
      { itemCode: "LAP-01", description: "Laptop", quantity: 5, unitPriceMinor: 5000000n, budgetLine: "IT-CAP", timelineQuarter: "Q1", sourceIndentId: "11111111-1111-4111-8111-111111111111" },
      { itemCode: "LAP-01", description: "Laptop", quantity: 3, unitPriceMinor: 5000000n, budgetLine: "IT-CAP", timelineQuarter: "Q1", sourceIndentId: "22222222-2222-4222-8222-222222222222" },
    ];
    const out = aggregateDemand(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.aggregatedQty).toBe(8);
    expect(out[0]!.estimatedValueMinor).toBe(5000000n * 8n);
    expect(out[0]!.sourceIndentIds).toHaveLength(2);
  });

  it("keeps distinct groups when budget line or quarter differ", () => {
    const rows: DemandInput[] = [
      { itemCode: "LAP-01", description: "Laptop", quantity: 5, unitPriceMinor: 100n, budgetLine: "A", timelineQuarter: "Q1" },
      { itemCode: "LAP-01", description: "Laptop", quantity: 5, unitPriceMinor: 100n, budgetLine: "B", timelineQuarter: "Q1" },
      { itemCode: "LAP-01", description: "Laptop", quantity: 5, unitPriceMinor: 100n, budgetLine: "A", timelineQuarter: "Q2" },
    ];
    expect(aggregateDemand(rows)).toHaveLength(3);
  });

  it("de-duplicates source indent ids", () => {
    const rows: DemandInput[] = [
      { itemCode: "X", description: "x", quantity: 1, unitPriceMinor: 1n, sourceIndentId: "aaaaaaaa-1111-4111-8111-111111111111" },
      { itemCode: "X", description: "x", quantity: 1, unitPriceMinor: 1n, sourceIndentId: "aaaaaaaa-1111-4111-8111-111111111111" },
    ];
    const out = aggregateDemand(rows);
    expect(out[0]!.sourceIndentIds).toEqual(["aaaaaaaa-1111-4111-8111-111111111111"]);
  });

  it("uses exact bigint arithmetic beyond 2^53", () => {
    const big = 9_000_000_000_000_000n;
    const out = aggregateDemand([{ itemCode: "B", description: "b", quantity: 3, unitPriceMinor: big }]);
    expect(out[0]!.estimatedValueMinor).toBe(big * 3n);
  });

  it("defaults category=goods and method=gem", () => {
    const out = aggregateDemand([{ itemCode: "Y", description: "y", quantity: 1, unitPriceMinor: 1n }]);
    expect(out[0]!.procurementCategory).toBe("goods");
    expect(out[0]!.procurementMethod).toBe("gem");
  });

  it("planTotalMinor sums line values", () => {
    expect(planTotalMinor([{ estimatedValueMinor: 100n }, { estimatedValueMinor: 250n }])).toBe(350n);
  });
});

describe("SVC-041 planning domain — status machine + maker-checker", () => {
  it("allows draft -> pending -> approved", () => {
    expect(() => assertTransitionAllowed("draft", "pending")).not.toThrow();
    expect(() => assertTransitionAllowed("pending", "approved")).not.toThrow();
  });

  it("rejects illegal transitions", () => {
    expect(() => assertTransitionAllowed("draft", "approved")).toThrow(DomainError);
    expect(() => assertTransitionAllowed("approved", "pending")).toThrow(DomainError);
  });

  it("allows rejected -> pending (resubmit)", () => {
    expect(() => assertTransitionAllowed("rejected", "pending")).not.toThrow();
  });

  it("rejects self-approval (maker === checker)", () => {
    expect(() => assertDistinctMakerChecker("u1", "u1")).toThrow(/SOD_VIOLATION/);
  });

  it("permits distinct maker/checker", () => {
    expect(() => assertDistinctMakerChecker("u1", "u2")).not.toThrow();
  });

  it("only approved plans may be linked to a tender", () => {
    expect(() => assertPlanApprovedForLinkage("approved")).not.toThrow();
    expect(() => assertPlanApprovedForLinkage("pending")).toThrow(/PLAN_NOT_APPROVED/);
  });
});
