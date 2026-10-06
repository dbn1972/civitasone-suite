import { describe, it, expect } from "vitest";
import { experimentWinnerDisplay, needsApproval, rankExperiments, statusLabel } from "./experiments";

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

describe("GAP-NOTIFICATIONS-EXPERIMENTS-04 winner display", () => {
  it("shows the variant name and click-rate margin when a winner is set", () => {
    expect(
      experimentWinnerDisplay({
        id: "1", name: "X", status: "concluded",
        winnerVariantId: "11111111-2222-3333-4444-555555555555",
        winnerVariantKey: "B", winnerMarginPct: 12, concludedAt: null,
      }),
    ).toBe("Variant B (+12% click-rate margin)");
  });

  it("falls back to a short id (never blank) when the key is unknown", () => {
    expect(
      experimentWinnerDisplay({
        id: "1", name: "X", status: "concluded",
        winnerVariantId: "abcdef12-2222-3333-4444-555555555555",
        winnerVariantKey: null, winnerMarginPct: null, concludedAt: null,
      }),
    ).toBe("abcdef12");
  });

  it("shows '—' (not a fabricated id) when there is no winner", () => {
    expect(
      experimentWinnerDisplay({
        id: "1", name: "X", status: "running",
        winnerVariantId: null, winnerVariantKey: null, winnerMarginPct: null, concludedAt: null,
      }),
    ).toBe("—");
  });

  it("does not label the margin as an open rate (it is a click-rate margin)", () => {
    const out = experimentWinnerDisplay({
      id: "1", name: "X", status: "concluded",
      winnerVariantId: "11111111-2222-3333-4444-555555555555",
      winnerVariantKey: "A", winnerMarginPct: 5, concludedAt: null,
    });
    expect(out).not.toMatch(/open rate/i);
    expect(out).toMatch(/click-rate margin/);
  });
});
