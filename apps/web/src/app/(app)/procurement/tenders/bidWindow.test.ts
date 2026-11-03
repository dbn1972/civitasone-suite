import { describe, it, expect } from "vitest";
import { bidClosingInstant, tenderBidWindow } from "./bidWindow";

const at = (iso: string) => new Date(iso);

describe("tenderBidWindow (UAT Phase 2 C4)", () => {
  const now = at("2026-11-03T06:30:00.000Z"); // 12:00 IST
  it("a draft tender is not yet published (was shown as Open)", () => {
    expect(tenderBidWindow("draft", "2026-12-01", now)).toBe("not_published");
    expect(tenderBidWindow("draft", "2026-10-01", now)).toBe("not_published");
  });
  it("awarded, cancelled and evaluation tenders are closed (was shown as Open)", () => {
    for (const s of ["awarded", "cancelled", "technical_evaluation", "financial_evaluation", "evaluation"]) {
      expect(tenderBidWindow(s, "2026-12-01", now)).toBe("closed");
    }
  });
  it("a published tender is open until its bid-close, then awaits opening", () => {
    expect(tenderBidWindow("published", "2026-11-04", now)).toBe("open");
    expect(tenderBidWindow("published", "2026-11-02", now)).toBe("closed_awaiting_opening");
  });
});

// Security review #2446 (8): compare the closing instant, not the date string.
describe("bid window closing-time edges", () => {
  const close = "2026-11-03T15:00:00+05:30"; // 15:00 IST = 09:30Z
  it("one minute before a timestamped close: open; one minute after: closed", () => {
    expect(tenderBidWindow("published", close, at("2026-11-03T09:29:00.000Z"))).toBe("open");
    expect(tenderBidWindow("published", close, at("2026-11-03T09:31:00.000Z"))).toBe("closed_awaiting_opening");
  });
  it("same calendar day after the closing hour is closed (the date-only compare said Open)", () => {
    expect(tenderBidWindow("published", close, at("2026-11-03T12:00:00.000Z"))).toBe("closed_awaiting_opening"); // 17:30 IST
  });
  it("a date-only close ends at 23:59:59.999 IST: 1 minute before open, 1 minute after closed", () => {
    // 2026-11-03 23:59:59.999 IST = 2026-11-03T18:29:59.999Z
    expect(tenderBidWindow("published", "2026-11-03", at("2026-11-03T18:28:59.999Z"))).toBe("open");
    expect(tenderBidWindow("published", "2026-11-03", at("2026-11-03T18:30:59.999Z"))).toBe("closed_awaiting_opening");
  });
  it("judges the instant in IST regardless of the UTC date (00:30 IST next day is closed)", () => {
    expect(tenderBidWindow("published", "2026-11-03", at("2026-11-03T19:00:00.000Z"))).toBe("closed_awaiting_opening");
  });
  it("bidClosingInstant: missing or unreadable values are null (treated as open)", () => {
    expect(bidClosingInstant(null)).toBeNull();
    expect(bidClosingInstant("not-a-date")).toBeNull();
    expect(tenderBidWindow("published", "not-a-date", at("2026-11-03T09:31:00.000Z"))).toBe("open");
    expect(bidClosingInstant(close)).toBe(Date.parse("2026-11-03T09:30:00.000Z"));
  });
});
