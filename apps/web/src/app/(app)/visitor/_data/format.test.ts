import { describe, it, expect } from "vitest";
import { fmtTime, fmtDateTime, isToday, isTodayOrLater } from "./format";

/**
 * GAP-VISITOR-HOME-03 / HOME-04: day-boundary and clock rendering must be
 * pinned to IST, not the Node server-process timezone. These assertions hold
 * regardless of the TZ the test process runs under (they pass an explicit
 * instant and, for isToday*, an explicit `now`), which is the whole point —
 * a UTC host must not shift the civil day by 5h30m.
 */
describe("visitor format — IST day boundary", () => {
  it("fmtTime renders the IST clock time regardless of process TZ", () => {
    // 09:00:00Z == 14:30 IST.
    expect(fmtTime("2026-09-29T09:00:00Z")).toBe("14:30");
  });

  it("fmtDateTime renders the IST date+time", () => {
    // 20:30Z on 29 Sep == 02:00 IST on 30 Sep. Month spelling ("Sep"/"Sept")
    // varies with the runtime's CLDR data, so assert the day + time precisely
    // and the month loosely.
    expect(fmtDateTime("2026-09-29T20:30:00Z")).toMatch(/^30 Sept?, 02:00$/);
  });

  it("isToday is true for an evening-IST instant that is 'tomorrow' in UTC terms", () => {
    // 2026-09-29T19:00Z == 2026-09-30T00:30 IST. If 'now' is 02:00 IST on
    // 30 Sep (2026-09-29T20:30Z), both are the 30 Sep IST civil day.
    const now = new Date("2026-09-29T20:30:00Z");
    expect(isToday("2026-09-29T19:00:00Z", now)).toBe(true);
  });

  it("isToday is false for an instant on a different IST civil day", () => {
    const now = new Date("2026-09-29T20:30:00Z"); // 30 Sep IST
    expect(isToday("2026-09-29T10:00:00Z", now)).toBe(false); // 29 Sep IST (15:30)
  });

  it("isTodayOrLater excludes yesterday but includes today and the future (IST)", () => {
    const now = new Date("2026-09-30T06:00:00Z"); // 11:30 IST on 30 Sep
    expect(isTodayOrLater("2026-09-29T06:00:00Z", now)).toBe(false); // 29 Sep IST
    expect(isTodayOrLater("2026-09-30T01:00:00Z", now)).toBe(true); // 30 Sep IST (06:30)
    expect(isTodayOrLater("2026-10-05T00:00:00Z", now)).toBe(true); // future
  });

  it("returns falsey/dash for empty input", () => {
    expect(isToday(null)).toBe(false);
    expect(fmtTime(null)).toBe("—");
  });
});
