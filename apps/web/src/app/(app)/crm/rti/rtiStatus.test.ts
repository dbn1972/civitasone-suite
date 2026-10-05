import { describe, it, expect, vi, afterEach } from "vitest";
import { isRtiClosed, rtiDaysLeft, rtiSlaBucket } from "./rtiStatus";

describe("rtiStatus helpers (GAP-CRM-RTI-01)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("isRtiClosed treats RESPONDED/REJECTED/DISPOSED as closed and open statuses as open", () => {
    expect(isRtiClosed("RESPONDED")).toBe(true);
    expect(isRtiClosed("REJECTED")).toBe(true);
    expect(isRtiClosed("DISPOSED")).toBe(true);
    expect(isRtiClosed("RECEIVED")).toBe(false);
    expect(isRtiClosed("TRANSFERRED")).toBe(false);
    expect(isRtiClosed("FIRST_APPEAL")).toBe(false);
    expect(isRtiClosed("SECOND_APPEAL")).toBe(false);
    expect(isRtiClosed(null)).toBe(false);
    expect(isRtiClosed(undefined)).toBe(false);
  });

  it("rtiDaysLeft returns null for a missing due date and negative for a past one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T06:00:00.000Z")); // 11:30 IST on 2026-10-05
    expect(rtiDaysLeft(null)).toBeNull();
    expect(rtiDaysLeft("not-a-date")).toBeNull();
    expect(rtiDaysLeft("2026-10-01T00:00:00.000Z")).toBe(-4);
    expect(rtiDaysLeft("2026-10-12T00:00:00.000Z")).toBe(7);
  });

  it("rtiSlaBucket: a closed request past its due date is 'closed', never 'overdue'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T06:00:00.000Z"));
    // Past due, but RESPONDED/REJECTED/DISPOSED -> closed, not overdue.
    expect(rtiSlaBucket("RESPONDED", "2026-09-01T00:00:00.000Z")).toBe("closed");
    expect(rtiSlaBucket("REJECTED", "2026-09-01T00:00:00.000Z")).toBe("closed");
    expect(rtiSlaBucket("DISPOSED", "2026-09-01T00:00:00.000Z")).toBe("closed");
  });

  it("rtiSlaBucket: an open request is bucketed by remaining days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T06:00:00.000Z"));
    expect(rtiSlaBucket("RECEIVED", "2026-09-01T00:00:00.000Z")).toBe("overdue");
    expect(rtiSlaBucket("TRANSFERRED", "2026-10-08T00:00:00.000Z")).toBe("critical"); // 3 days
    expect(rtiSlaBucket("FIRST_APPEAL", "2026-11-30T00:00:00.000Z")).toBe("due");
    expect(rtiSlaBucket("RECEIVED", null)).toBe("due");
  });
});
