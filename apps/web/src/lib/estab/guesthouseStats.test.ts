import { describe, it, expect, vi, afterEach } from "vitest";
import { countGuesthouseStats } from "./guesthouseStats";

afterEach(() => vi.useRealTimers());

describe("countGuesthouseStats (GAP-ESTAB-GUESTHOUSE-04)", () => {
  it("a confirmed booking checking in today (IST) is NOT upcoming; tomorrow's is", () => {
    // 2026-09-29T02:00:00Z == 2026-09-29 07:30 IST (today = 2026-09-29 IST).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T02:00:00.000Z"));

    const stats = countGuesthouseStats([
      // Same-day datetime check-in — must NOT count as upcoming.
      { status: "confirmed", checkInDate: "2026-09-29T14:00:00.000Z" },
      // Tomorrow — upcoming.
      { status: "confirmed", checkInDate: "2026-09-30T06:00:00.000Z" },
      { status: "pending", checkInDate: "2026-10-01T06:00:00.000Z" },
      { status: "checked_in", checkInDate: "2026-09-28T06:00:00.000Z" },
    ]);

    expect(stats.total).toBe(4);
    // Tomorrow confirmed + pending at 2026-10-01 are both upcoming.
    expect(stats.upcoming).toBe(2);
    // confirmed + pending (not yet checked in): 2 confirmed + 1 pending = 3.
    expect(stats.pendingApproval).toBe(3);
    expect(stats.occupied).toBe(1);
  });

  it("handles bare calendar-date check-ins", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T02:00:00.000Z"));
    const stats = countGuesthouseStats([
      { status: "confirmed", checkInDate: "2026-09-29" }, // today -> not upcoming
      { status: "confirmed", checkInDate: "2026-09-30" }, // tomorrow -> upcoming
    ]);
    expect(stats.upcoming).toBe(1);
  });
});
