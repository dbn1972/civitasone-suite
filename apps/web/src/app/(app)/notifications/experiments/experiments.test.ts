import { describe, it, expect } from "vitest";
import { needsApproval, rankExperiments, statusLabel } from "./experiments";

describe("P2-9 experiment FE helpers", () => {
  it("flags pending approval for the approval gate", () => {
    expect(needsApproval("pending_approval")).toBe(true);
    expect(needsApproval("running")).toBe(false);
  });

  it("ranks awaiting-approval experiments first", () => {
    const ranked = rankExperiments([
      { id: "1", name: "B", status: "concluded", winnerVariantId: null, winnerMarginPct: null, concludedAt: null },
      { id: "2", name: "A", status: "pending_approval", winnerVariantId: null, winnerMarginPct: null, concludedAt: null },
    ]);
    expect(ranked[0]?.id).toBe("2");
    expect(statusLabel("pending_approval")).toContain("approval");
  });
});
