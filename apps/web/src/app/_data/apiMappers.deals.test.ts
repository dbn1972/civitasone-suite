import { describe, it, expect } from "vitest";
import { mapDealSummaries } from "./apiMappers";

describe("mapDealSummaries money (GAP-CRM-DEALS-04)", () => {
  it("returns the amount as an exact paise digit string, never a JS number", () => {
    const out = mapDealSummaries([
      { id: "1", dealName: "A", stage: "Proposal", valueMinor: "9007199254740993", status: "open" },
    ]);
    expect(out).not.toBeNull();
    expect(out![0].amount).toBe("9007199254740993");
    expect(typeof out![0].amount).toBe("string");
  });

  it("preserves precision above 2^53 (would be lost as a number)", () => {
    const out = mapDealSummaries([
      { id: "1", dealName: "A", stage: "Proposal", valueMinor: "9007199254740993", status: "open" },
      { id: "2", dealName: "B", stage: "Proposal", valueMinor: "1", status: "open" },
    ]);
    const sum = out!.reduce((s, d) => s + BigInt(d.amount), 0n);
    expect(sum).toBe(9007199254740994n);
  });

  it("falls back to a legacy numeric `amount` field and still yields a string", () => {
    const out = mapDealSummaries([
      { id: "1", dealName: "A", stage: "Proposal", amount: 50000000, status: "open" },
    ]);
    expect(out![0].amount).toBe("50000000");
  });

  it("yields '0' (not a fabricated value) when the amount is missing/unparseable", () => {
    const out = mapDealSummaries([
      { id: "1", dealName: "A", stage: "Proposal", valueMinor: "not-a-number", status: "open" },
    ]);
    expect(out![0].amount).toBe("0");
  });
});

describe("normalizeDealStage round-trip (GAP-CRM-DEALS-NEW-02)", () => {
  // Every value the create form can submit must map to a valid DealSummary stage.
  const CASES: Array<[string, string]> = [
    ["Lead", "prospecting"],
    ["Proposal", "proposal"],
    ["Negotiation", "negotiation"],
    ["Won", "closed_won"],
    ["Lost", "closed_lost"],
    ["prospecting", "prospecting"],
    ["closed_won", "closed_won"],
  ];
  for (const [input, expected] of CASES) {
    it(`maps "${input}" -> "${expected}"`, () => {
      const out = mapDealSummaries([{ id: "1", dealName: "A", stage: input, status: "open" }]);
      expect(out![0].stage).toBe(expected);
    });
  }
});
