import { describe, it, expect } from "vitest";
import { parseRunStatus, runState, pendingTotals, postedTotals } from "./runStatus";

const book = (over: Record<string, unknown> = {}) => ({
  depBook: "company", pendingCount: 2, pendingMinor: "150000", postedCount: 0, postedMinor: "0", lastPostedAt: null, ...over,
});

describe("runStatus (GAP-ASSETS-DEPRECIATION-02)", () => {
  it("parses books, totals pending amounts as exact bigint sums and keeps the last-posted indicator", () => {
    const s = parseRunStatus({
      period: "2026-09",
      books: [book(), book({ depBook: "statutory", pendingCount: 1, pendingMinor: "9007199254740993" })],
      lastPosted: { period: "2026-08", postedAt: "2026-09-02T05:00:00.000Z" },
    })!;
    expect(runState(s)).toBe("ready");
    expect(pendingTotals(s)).toEqual({ count: 3, minor: "9007199254890993" });
    expect(s.lastPosted?.period).toBe("2026-08");
  });

  it("reports already_posted when every entry is posted, no_entries when none exist", () => {
    const posted = parseRunStatus({ period: "2026-08", books: [book({ pendingCount: 0, pendingMinor: "0", postedCount: 4, postedMinor: "400" })], lastPosted: null })!;
    expect(runState(posted)).toBe("already_posted");
    expect(postedTotals(posted)).toEqual({ count: 4, minor: "400" });
    expect(runState(parseRunStatus({ period: "2026-09", books: [], lastPosted: null })!)).toBe("no_entries");
  });

  it("rejects a malformed payload and sanitises bad amounts to zero", () => {
    expect(parseRunStatus(null)).toBeNull();
    expect(parseRunStatus({ period: "2026-09" })).toBeNull();
    const s = parseRunStatus({ period: "2026-09", books: [book({ pendingMinor: "1e9", pendingCount: -3 })], lastPosted: {} })!;
    expect(s.books[0]).toMatchObject({ pendingMinor: "0", pendingCount: 0 });
    expect(s.lastPosted).toBeNull();
  });
});
