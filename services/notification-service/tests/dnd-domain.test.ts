/**
 * DND (Do Not Disturb) window evaluation — pure, timezone-aware domain logic
 * that had no test coverage at all.
 *
 * This decides whether a citizen gets woken at 03:00, so the overnight-window
 * and timezone branches are the ones that matter. All assertions pin an explicit
 * `now`, so nothing here depends on the wall clock or the machine's TZ.
 */
import { describe, it, expect } from "vitest";
import { evaluateWindow, isDndActive, type DndWindow } from "../src/modules/dnd/domain.js";

const ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function window(over: Partial<DndWindow> = {}): DndWindow {
  return {
    startTime: "22:00",
    endTime: "06:00",
    timezone: "Asia/Kolkata",
    days: ALL_DAYS,
    enabled: true,
    ...over,
  };
}

/** 2026-03-10 is a Tuesday. IST is UTC+05:30 with no DST. */
const IST_OFFSET_MS = 5.5 * 3600_000;
/** Build a UTC instant at which the IST wall clock reads hh:mm on 2026-03-10. */
function atIst(hh: number, mm = 0): Date {
  return new Date(Date.UTC(2026, 2, 10, hh, mm) - IST_OFFSET_MS);
}

describe("evaluateWindow — daytime (non-overnight) window", () => {
  const day = window({ startTime: "09:00", endTime: "17:00" });

  it("is inactive before the window opens", () => {
    expect(evaluateWindow(day, atIst(8, 59))).toBe(false);
  });

  it("is active exactly at the start boundary (inclusive)", () => {
    expect(evaluateWindow(day, atIst(9, 0))).toBe(true);
  });

  it("is active in the middle", () => {
    expect(evaluateWindow(day, atIst(13, 0))).toBe(true);
  });

  it("is active one minute before the end", () => {
    expect(evaluateWindow(day, atIst(16, 59))).toBe(true);
  });

  it("is inactive exactly at the end boundary (exclusive)", () => {
    expect(evaluateWindow(day, atIst(17, 0))).toBe(false);
  });

  it("is inactive after the window closes", () => {
    expect(evaluateWindow(day, atIst(20, 0))).toBe(false);
  });
});

describe("evaluateWindow — overnight window (22:00 → 06:00)", () => {
  const night = window();

  it("is inactive just before the window opens", () => {
    expect(evaluateWindow(night, atIst(21, 59))).toBe(false);
  });

  it("is active at the start", () => {
    expect(evaluateWindow(night, atIst(22, 0))).toBe(true);
  });

  it("is active late in the evening", () => {
    expect(evaluateWindow(night, atIst(23, 30))).toBe(true);
  });

  it("is active after midnight — the branch a naive range check gets wrong", () => {
    expect(evaluateWindow(night, atIst(2, 0))).toBe(true);
  });

  it("is active one minute before the end", () => {
    expect(evaluateWindow(night, atIst(5, 59))).toBe(true);
  });

  it("is inactive exactly at the end boundary", () => {
    expect(evaluateWindow(night, atIst(6, 0))).toBe(false);
  });

  it("is inactive during the working day", () => {
    expect(evaluateWindow(night, atIst(12, 0))).toBe(false);
  });
});

describe("evaluateWindow — enablement and day-of-week", () => {
  it("a disabled window is never active", () => {
    expect(evaluateWindow(window({ enabled: false }), atIst(2, 0))).toBe(false);
  });

  it("is inactive on a day not listed", () => {
    // 2026-03-10 is a Tuesday; a weekend-only window must not fire.
    expect(evaluateWindow(window({ days: ["sat", "sun"] }), atIst(2, 0))).toBe(false);
  });

  it("is active on a day that is listed", () => {
    expect(evaluateWindow(window({ days: ["tue"] }), atIst(2, 0))).toBe(true);
  });

  it("an empty day list is never active", () => {
    expect(evaluateWindow(window({ days: [] }), atIst(2, 0))).toBe(false);
  });

  it("accepts HH:mm:ss times", () => {
    const w = window({ startTime: "09:00:00", endTime: "17:00:00" });
    expect(evaluateWindow(w, atIst(10, 0))).toBe(true);
    expect(evaluateWindow(w, atIst(18, 0))).toBe(false);
  });
});

describe("evaluateWindow — timezone awareness", () => {
  it("the same instant is inside an IST night window and outside the UTC one", () => {
    // 20:00 UTC on 2026-03-10 = 01:30 IST on 2026-03-11.
    const instant = new Date(Date.UTC(2026, 2, 10, 20, 0));
    expect(evaluateWindow(window({ timezone: "Asia/Kolkata" }), instant)).toBe(true);
    expect(evaluateWindow(window({ timezone: "UTC" }), instant)).toBe(false);
  });

  it("evaluates a UTC window against UTC wall-clock time", () => {
    const instant = new Date(Date.UTC(2026, 2, 10, 23, 0));
    expect(evaluateWindow(window({ timezone: "UTC" }), instant)).toBe(true);
  });

  it("handles a western timezone", () => {
    // 2026-03-10 08:00 UTC = 2026-03-10 03:00 America/New_York (EDT, UTC-4).
    const instant = new Date(Date.UTC(2026, 2, 10, 8, 0));
    expect(evaluateWindow(window({ timezone: "America/New_York" }), instant)).toBe(true);
  });
});

describe("isDndActive", () => {
  it("delivers when there are no windows", () => {
    expect(isDndActive([], atIst(2, 0))).toEqual({ action: "deliver" });
  });

  it("delivers when no window is active", () => {
    expect(isDndActive([window()], atIst(12, 0))).toEqual({ action: "deliver" });
  });

  it("delivers when the only matching window is disabled", () => {
    expect(isDndActive([window({ enabled: false })], atIst(2, 0)).action).toBe("deliver");
  });

  it("holds when a window is active and returns a release time", () => {
    const decision = isDndActive([window()], atIst(2, 0));
    expect(decision.action).toBe("hold");
    if (decision.action === "hold") {
      // 02:00 IST is inside the post-midnight portion, so release is 06:00 IST
      // the same day = 00:30 UTC.
      expect(decision.releaseAt.toISOString()).toBe("2026-03-10T00:30:00.000Z");
      expect(decision.releaseAt.getTime()).toBeGreaterThan(atIst(2, 0).getTime());
    }
  });

  it("releases the NEXT morning when held before midnight", () => {
    const heldAt = atIst(23, 0);
    const decision = isDndActive([window()], heldAt);
    expect(decision.action).toBe("hold");
    if (decision.action === "hold") {
      // 23:00 IST on the 10th → release 06:00 IST on the 11th = 00:30 UTC 11th.
      expect(decision.releaseAt.toISOString()).toBe("2026-03-11T00:30:00.000Z");
      expect(decision.releaseAt.getTime()).toBeGreaterThan(heldAt.getTime());
    }
  });

  it("computes the release for a daytime window on the same day", () => {
    const decision = isDndActive([window({ startTime: "09:00", endTime: "17:00" })], atIst(13, 0));
    expect(decision.action).toBe("hold");
    if (decision.action === "hold") {
      // 17:00 IST = 11:30 UTC.
      expect(decision.releaseAt.toISOString()).toBe("2026-03-10T11:30:00.000Z");
    }
  });

  it("the release time is always in the future while the window is active", () => {
    for (const hour of [22, 23, 0, 1, 3, 5]) {
      const now = atIst(hour, 0);
      const decision = isDndActive([window()], now);
      expect(decision.action).toBe("hold");
      if (decision.action === "hold") {
        expect(decision.releaseAt.getTime()).toBeGreaterThan(now.getTime());
      }
    }
  });

  it("returns the FIRST active window's release time", () => {
    const early = window({ startTime: "01:00", endTime: "03:00" });
    const late = window({ startTime: "01:30", endTime: "05:00" });
    const decision = isDndActive([early, late], atIst(2, 0));
    expect(decision.action).toBe("hold");
    if (decision.action === "hold") {
      // 03:00 IST = 21:30 UTC the previous day.
      expect(decision.releaseAt.toISOString()).toBe("2026-03-09T21:30:00.000Z");
    }
  });

  it("skips inactive windows and holds on a later active one", () => {
    const inactive = window({ days: ["sat"] });
    const active = window({ startTime: "01:00", endTime: "04:00" });
    expect(isDndActive([inactive, active], atIst(2, 0)).action).toBe("hold");
  });

  it("holds in a UTC timezone window too", () => {
    const decision = isDndActive(
      [window({ timezone: "UTC", startTime: "22:00", endTime: "06:00" })],
      new Date(Date.UTC(2026, 2, 10, 23, 0)),
    );
    expect(decision.action).toBe("hold");
    if (decision.action === "hold") {
      expect(decision.releaseAt.toISOString()).toBe("2026-03-11T06:00:00.000Z");
    }
  });
});
