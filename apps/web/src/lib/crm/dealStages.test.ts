import { describe, it, expect } from "vitest";
import { DEAL_STAGES, STAGE_DEFAULT_PROBABILITY } from "./dealStages";
import { mapDealSummaries } from "@/app/_data/apiMappers";

describe("DEAL_STAGES (GAP-CRM-DEALS-NEW-02)", () => {
  it("every create-form option value round-trips through the mapper to its canonical stage", () => {
    for (const opt of DEAL_STAGES) {
      const out = mapDealSummaries([{ id: "1", dealName: "A", stage: opt.value, status: "open" }]);
      expect(out).not.toBeNull();
      expect(out![0].stage).toBe(opt.canonical);
    }
  });

  it("offers only open stages — never a terminal Won/Lost", () => {
    const values = DEAL_STAGES.map((s) => s.value);
    expect(values).not.toContain("Won");
    expect(values).not.toContain("Lost");
    // Matches the HIGH-batch GAP-CRM-DEALS-NEW-01 decision exactly.
    expect(values).toEqual(["Lead", "Proposal", "Negotiation"]);
  });

  it("has a probability default for every stage", () => {
    for (const opt of DEAL_STAGES) {
      expect(typeof STAGE_DEFAULT_PROBABILITY[opt.value]).toBe("number");
    }
  });
});
