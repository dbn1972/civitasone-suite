/**
 * Notification DND (Do Not Disturb) — Domain Tests
 *
 * Module: services/notification-service/src/modules/dnd
 * Pack: Notification_Module_Test_Pack/12_DND_Test_Prompt.md
 *
 * Tests:
 *   1. evaluateWindow: timezone-aware window evaluation
 *   2. isDndActive: multi-window evaluation with deliver/hold decisions
 *   3. Overnight windows (e.g., 22:00 – 06:00)
 *   4. Day-of-week filtering
 *   5. Disabled windows bypassed
 *   6. Hold returns a releaseAt timestamp
 */
import { describe, it, expect } from "vitest";
import { evaluateWindow, isDndActive, type DndWindow } from "../src/modules/dnd/domain.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const WEEKNIGHT_WINDOW: DndWindow = {
  startTime: "22:00",
  endTime: "06:00",
  timezone: "UTC",
  days: ["mon", "tue", "wed", "thu", "fri"],
  enabled: true,
};

const OFFICE_HOURS_WINDOW: DndWindow = {
  startTime: "09:00",
  endTime: "17:00",
  timezone: "UTC",
  days: ["mon", "tue", "wed", "thu", "fri"],
  enabled: true,
};

// ─── 1. evaluateWindow — timezone-aware evaluation ───────────────────────────

describe("evaluateWindow — single window evaluation", () => {
  it("disabled window → always false (no DND)", () => {
    const w: DndWindow = { ...OFFICE_HOURS_WINDOW, enabled: false };
    expect(evaluateWindow(w, new Date("2026-07-15T12:00:00Z"))).toBe(false); // Tuesday noon
  });

  it("within window time + correct day → active", () => {
    // Tuesday 23:00 UTC — within weeknight 22:00-06:00 + weekday
    expect(evaluateWindow(WEEKNIGHT_WINDOW, new Date("2026-07-14T23:00:00Z"))).toBe(true); // Tuesday
  });

  it("outside window time → not active", () => {
    // Tuesday 12:00 UTC — outside 22:00-06:00
    expect(evaluateWindow(WEEKNIGHT_WINDOW, new Date("2026-07-14T12:00:00Z"))).toBe(false);
  });

  it("correct time but wrong day → not active", () => {
    // Saturday 23:00 UTC — weeknight window only covers mon-fri
    expect(evaluateWindow(WEEKNIGHT_WINDOW, new Date("2026-07-18T23:00:00Z"))).toBe(false); // Saturday
  });

  it("non-overnight window: 09:00-17:00, at 12:00 → active", () => {
    // Wednesday noon
    expect(evaluateWindow(OFFICE_HOURS_WINDOW, new Date("2026-07-15T12:00:00Z"))).toBe(true);
  });

  it("non-overnight window: at 18:00 → not active", () => {
    expect(evaluateWindow(OFFICE_HOURS_WINDOW, new Date("2026-07-15T18:00:00Z"))).toBe(false);
  });
});

// ─── 2. isDndActive — multi-window decision ──────────────────────────────────

describe("isDndActive — deliver or hold decision", () => {
  it("no windows → deliver", () => {
    const r = isDndActive([], new Date());
    expect(r.action).toBe("deliver");
  });

  it("all windows disabled → deliver", () => {
    const r = isDndActive([{ ...WEEKNIGHT_WINDOW, enabled: false }], new Date("2026-07-14T23:00:00Z"));
    expect(r.action).toBe("deliver");
  });

  it("active window → hold with releaseAt", () => {
    const r = isDndActive([WEEKNIGHT_WINDOW], new Date("2026-07-14T23:00:00Z")); // Tuesday 23:00
    expect(r.action).toBe("hold");
    if (r.action === "hold") {
      expect(r.releaseAt).toBeInstanceOf(Date);
      // releaseAt should be after now
      expect(r.releaseAt.getTime()).toBeGreaterThan(new Date("2026-07-14T23:00:00Z").getTime());
    }
  });

  it("multiple windows: first active one wins", () => {
    const windows: DndWindow[] = [
      { ...OFFICE_HOURS_WINDOW, enabled: false }, // disabled — skipped
      WEEKNIGHT_WINDOW, // this one active at 23:00
    ];
    const r = isDndActive(windows, new Date("2026-07-14T23:00:00Z"));
    expect(r.action).toBe("hold");
  });

  it("outside all windows → deliver", () => {
    const r = isDndActive([WEEKNIGHT_WINDOW], new Date("2026-07-14T12:00:00Z")); // Tuesday noon
    expect(r.action).toBe("deliver");
  });
});

// ─── 3. Overnight window specifics ───────────────────────────────────────────

describe("overnight windows (start > end)", () => {
  it("before midnight (22:00-23:59) → active", () => {
    expect(evaluateWindow(WEEKNIGHT_WINDOW, new Date("2026-07-14T22:30:00Z"))).toBe(true); // Tue 22:30
  });

  it("after midnight (00:00-05:59) → active", () => {
    // Wednesday 03:00 UTC — within the overnight window that started Tuesday
    expect(evaluateWindow(WEEKNIGHT_WINDOW, new Date("2026-07-15T03:00:00Z"))).toBe(true); // Wed
  });

  it("at window end time (06:00) → NOT active (end exclusive)", () => {
    // The endTime comparison is `nowMinutes < endMinutes`, so 06:00 is NOT inside
    expect(evaluateWindow(WEEKNIGHT_WINDOW, new Date("2026-07-15T06:00:00Z"))).toBe(false);
  });
});

// ─── 4. Day-of-week handling ─────────────────────────────────────────────────

describe("day-of-week filtering", () => {
  const WEEKEND_ONLY: DndWindow = {
    startTime: "00:00",
    endTime: "23:59",
    timezone: "UTC",
    days: ["sat", "sun"],
    enabled: true,
  };

  it("Saturday → active", () => {
    expect(evaluateWindow(WEEKEND_ONLY, new Date("2026-07-18T12:00:00Z"))).toBe(true); // Sat
  });

  it("Monday → not active", () => {
    expect(evaluateWindow(WEEKEND_ONLY, new Date("2026-07-13T12:00:00Z"))).toBe(false); // Mon
  });
});
