/**
 * CLOS-S5-04 -- startHearingReminderCron() discarded both its setTimeout and
 * the setInterval created inside it, so neither could be cleared on shutdown.
 * It must return a stop() that cancels both (including the not-yet-created
 * interval), and the timers must not keep the event loop alive.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const selectSpy = vi.fn();
vi.mock("../src/shared/db.js", () => {
  const chain = { from: () => ({ where: async () => [] }) };
  return {
    db: { select: (...a: unknown[]) => { selectSpy(...a); return chain; }, update: vi.fn() },
    sqlClient: { end: vi.fn() },
  };
});
vi.mock("../src/shared/infra.js", () => ({ queue: { publish: vi.fn() } }));

import { startHearingReminderCron } from "../src/cron/hearing-reminders.js";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  selectSpy.mockClear();
  vi.useFakeTimers({ now: new Date("2026-10-22T07:00:00Z") });
});
afterEach(() => { vi.useRealTimers(); });

describe("CLOS-S5-04: hearing reminder cron shutdown", () => {
  it("runs on the daily schedule while started (control)", async () => {
    const stop = startHearingReminderCron();
    await vi.advanceTimersByTimeAsync(3 * DAY);
    // startup run (2 selects) + 3 daily runs
    expect(selectSpy.mock.calls.length).toBeGreaterThan(2);
    stop();
  });

  it("stop() before the first daily tick cancels everything", async () => {
    const stop = startHearingReminderCron();
    await vi.advanceTimersByTimeAsync(0);
    const afterStartup = selectSpy.mock.calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(5 * DAY);
    expect(selectSpy.mock.calls.length).toBe(afterStartup);
  });

  it("stop() after the daily interval was created cancels the interval", async () => {
    const stop = startHearingReminderCron();
    await vi.advanceTimersByTimeAsync(2 * DAY);
    const before = selectSpy.mock.calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(5 * DAY);
    expect(selectSpy.mock.calls.length).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stop() is idempotent", () => {
    const stop = startHearingReminderCron();
    stop();
    expect(() => stop()).not.toThrow();
  });
});
