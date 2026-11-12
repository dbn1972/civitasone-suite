/**
 * Day boundaries are computed in the tenant's zone (default Asia/Kolkata), never in the host's.
 * A single pass for 14 Nov must be valid until 23:59:59.999 IST on 14 Nov on a UTC host AND with
 * TZ=Asia/Kolkata, and the check-in window must use the very same boundary.
 */
import { afterEach, describe, expect, it } from "vitest";
import { startOfDayInZone, endOfDayInZone, resolveTimeZone, isValidTimeZone, DEFAULT_TIME_ZONE } from "../src/shared/tz.js";
import { computeValidityWindow } from "../src/modules/digital-pass/domain.js";
import { evaluateCheckInWindow, checkInWindowBounds, startOfIstDay } from "../src/modules/check-in/window.js";

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => { if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ; });

// Visit scheduled 10:00 IST on 14 Nov 2026.
const FROM = new Date("2026-11-14T04:30:00.000Z");
const IST_END = "2026-11-14T18:29:59.999Z"; // 23:59:59.999 IST, 14 Nov
const IST_START = "2026-11-13T18:30:00.000Z"; // 00:00 IST, 14 Nov

describe("single pass validity is end-of-day IST regardless of the host TZ", () => {
  for (const hostTz of ["UTC", "Asia/Kolkata", "America/Los_Angeles", "Pacific/Auckland"]) {
    it(`host TZ=${hostTz}`, () => {
      process.env.TZ = hostTz;
      const w = computeValidityWindow("single", FROM);
      expect(w.validFrom).toEqual(FROM);
      expect(w.validUntil.toISOString()).toBe(IST_END);
    });
  }

  it("a pass is still valid at 23:59:59 IST and expired at 00:00:00 IST the next day", () => {
    process.env.TZ = "UTC";
    const w = computeValidityWindow("single", FROM);
    expect(evaluateCheckInWindow(new Date("2026-11-14T18:29:59.000Z"), w.validFrom, w.validUntil).ok).toBe(true);
    expect(evaluateCheckInWindow(new Date("2026-11-14T18:30:00.000Z"), w.validFrom, w.validUntil)).toMatchObject({ ok: false, code: "PASS_EXPIRED" });
  });
});

describe("tenant timezone", () => {
  it("uses the tenant's zone when given", () => {
    const ny = new Date("2026-11-14T15:00:00.000Z"); // 10:00 EST on 14 Nov
    const w = computeValidityWindow("single", ny, undefined, { timeZone: "America/New_York" });
    expect(w.validUntil.toISOString()).toBe("2026-11-15T04:59:59.999Z"); // 23:59:59.999 EST (UTC-5) on 14 Nov
  });
  it("falls back to Asia/Kolkata for missing or invalid zones", () => {
    expect(resolveTimeZone(undefined)).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone("Not/AZone")).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone("")).toBe(DEFAULT_TIME_ZONE);
    expect(computeValidityWindow("single", FROM, undefined, { timeZone: "Not/AZone" }).validUntil.toISOString()).toBe(IST_END);
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
  });
  it("handles DST days (London 29 Mar 2026 is 23h long; 25 Oct 2026 is 25h long)", () => {
    expect(endOfDayInZone(new Date("2026-03-29T12:00:00Z"), "Europe/London").toISOString()).toBe("2026-03-29T22:59:59.999Z");
    expect(startOfDayInZone(new Date("2026-03-29T12:00:00Z"), "Europe/London").toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(endOfDayInZone(new Date("2026-10-25T12:00:00Z"), "Europe/London").toISOString()).toBe("2026-10-25T23:59:59.999Z");
  });
});

describe("check-in window and pass validity share one boundary", () => {
  it("start-of-day opens at 00:00 IST of the pass's day and closes at the pass's end of day", () => {
    process.env.TZ = "UTC";
    const w = computeValidityWindow("single", FROM);
    const b = checkInWindowBounds(w.validFrom, w.validUntil, { fromStartOfDay: true, graceMs: 0, timeZone: "Asia/Kolkata" });
    expect(b.opensAt.toISOString()).toBe(IST_START);
    expect(b.closesAt.toISOString()).toBe(IST_END);
    expect(startOfIstDay(FROM).toISOString()).toBe(IST_START);
  });
  it("the window follows the tenant zone too", () => {
    const b = checkInWindowBounds(new Date("2026-11-14T15:00:00.000Z"), new Date("2026-11-15T04:59:59.999Z"), { fromStartOfDay: true, graceMs: 0, timeZone: "America/New_York" });
    expect(b.opensAt.toISOString()).toBe("2026-11-14T05:00:00.000Z"); // 00:00 EST on 14 Nov
  });
});
