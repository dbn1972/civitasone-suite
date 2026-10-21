import { describe, it, expect } from "vitest";
import { reviewingDecisionFromHistory } from "./reviewingDecision";

const rvRow = (payload: unknown) => ({ fromStage: "reviewing_officer", toStage: "accepting_authority", payload });

describe("reviewingDecisionFromHistory (GAP-HR-APAR-DETAIL-03)", () => {
  it("returns null for an empty history or one with no reviewing-officer row", () => {
    expect(reviewingDecisionFromHistory([])).toBeNull();
    expect(reviewingDecisionFromHistory([
      { fromStage: "self_pending", toStage: "reporting_officer", payload: { selfAppraisal: "x" } },
    ])).toBeNull();
  });

  it("reads a concurrence", () => {
    expect(reviewingDecisionFromHistory([rvRow({ decision: "concur", variations: [] })]))
      .toEqual({ decision: "concur", variations: [] });
  });

  it("reads a variation with its per-attribute scores", () => {
    expect(reviewingDecisionFromHistory([rvRow({ decision: "vary", variations: [{ attribute: "Quality", score: 7 }, { attribute: "Teamwork", score: 5 }] })]))
      .toEqual({ decision: "vary", variations: [{ attribute: "Quality", score: 7 }, { attribute: "Teamwork", score: 5 }] });
  });

  it("drops malformed variation entries instead of rendering garbage", () => {
    const r = reviewingDecisionFromHistory([rvRow({ decision: "vary", variations: [{ attribute: "Quality", score: 7 }, { attribute: "", score: 3 }, { score: 4 }, { attribute: "X", score: "9" }, null, 5] })]);
    expect(r?.variations).toEqual([{ attribute: "Quality", score: 7 }]);
  });

  it("ignores the stripped payload the API sends the appraisee before disclosure", () => {
    expect(reviewingDecisionFromHistory([rvRow({})])).toBeNull();
  });

  it("ignores an unknown decision value", () => {
    expect(reviewingDecisionFromHistory([rvRow({ decision: "approve" })])).toBeNull();
  });

  it("takes the latest reviewing-officer row when more than one exists", () => {
    expect(reviewingDecisionFromHistory([
      rvRow({ decision: "concur", variations: [] }),
      { fromStage: "accepting_authority", toStage: "disclosed", payload: {} },
      rvRow({ decision: "vary", variations: [{ attribute: "Quality", score: 6 }] }),
    ])?.decision).toBe("vary");
  });

  it("does not carry variations on a concurrence even if the payload has stray ones", () => {
    expect(reviewingDecisionFromHistory([rvRow({ decision: "concur", variations: [{ attribute: "Quality", score: 6 }] })])?.variations).toEqual([]);
  });
});
