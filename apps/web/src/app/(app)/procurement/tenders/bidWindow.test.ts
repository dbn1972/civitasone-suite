import { describe, it, expect } from "vitest";
import { tenderBidWindow } from "./bidWindow";

describe("tenderBidWindow (UAT Phase 2 C4)", () => {
  const today = "2026-11-03";
  it("a draft tender is not yet published (was shown as Open)", () => {
    expect(tenderBidWindow("draft", "2026-12-01", today)).toBe("not_published");
    expect(tenderBidWindow("draft", "2026-10-01", today)).toBe("not_published");
  });
  it("awarded, cancelled and evaluation tenders are closed (was shown as Open)", () => {
    for (const s of ["awarded", "cancelled", "technical_evaluation", "financial_evaluation", "evaluation"]) {
      expect(tenderBidWindow(s, "2026-12-01", today)).toBe("closed");
    }
  });
  it("a published tender is open until its bid-close date, then awaits opening", () => {
    expect(tenderBidWindow("published", "2026-11-03", today)).toBe("open");
    expect(tenderBidWindow("published", "2026-11-04", today)).toBe("open");
    expect(tenderBidWindow("published", "2026-11-02", today)).toBe("closed_awaiting_opening");
  });
});
