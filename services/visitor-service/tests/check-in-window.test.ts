/**
 * Check-in validity window (pure). A single pass is valid from its SCHEDULED TIME to end of day, so a
 * visitor arriving early (or a pass for later today) was refused. Tenant policy can widen the window;
 * the defaults keep the strict behaviour, and an expired pass is still refused.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateCheckInWindow, startOfIstDay, checkInWindowBounds, STRICT_WINDOW_POLICY,
} from "../src/modules/check-in/window.js";

// Scheduled 10:00 IST on 10 Jun 2030, valid to end of that IST day.
const FROM = new Date("2030-06-10T04:30:00.000Z");
const UNTIL = new Date("2030-06-10T18:29:59.999Z");
const at = (iso: string) => new Date(iso);

describe("startOfIstDay", () => {
  it("is 00:00 IST (18:30Z the previous day)", () => {
    expect(startOfIstDay(FROM).toISOString()).toBe("2030-06-09T18:30:00.000Z");
    expect(startOfIstDay(UNTIL).toISOString()).toBe("2030-06-09T18:30:00.000Z");
  });
  it("is stable on the boundary instant itself", () => {
    expect(startOfIstDay(at("2030-06-09T18:30:00.000Z")).toISOString()).toBe("2030-06-09T18:30:00.000Z");
    expect(startOfIstDay(at("2030-06-09T18:29:59.999Z")).toISOString()).toBe("2030-06-08T18:30:00.000Z");
  });
});

describe("evaluateCheckInWindow - strict (default policy, previous behaviour)", () => {
  it("refuses before validFrom with PASS_NOT_YET_VALID", () => {
    const r = evaluateCheckInWindow(at("2030-06-10T04:00:00.000Z"), FROM, UNTIL);
    expect(r).toMatchObject({ ok: false, code: "PASS_NOT_YET_VALID" });
  });
  it("admits exactly at validFrom and exactly at validUntil (inclusive)", () => {
    expect(evaluateCheckInWindow(FROM, FROM, UNTIL).ok).toBe(true);
    expect(evaluateCheckInWindow(UNTIL, FROM, UNTIL).ok).toBe(true);
  });
  it("refuses after validUntil with PASS_EXPIRED", () => {
    const r = evaluateCheckInWindow(at("2030-06-10T18:30:00.000Z"), FROM, UNTIL);
    expect(r).toMatchObject({ ok: false, code: "PASS_EXPIRED" });
  });
  it("fails closed on an invalid timestamp", () => {
    expect(evaluateCheckInWindow(new Date("nope"), FROM, UNTIL).ok).toBe(false);
  });
});

describe("evaluateCheckInWindow - fromStartOfDay", () => {
  const policy = { fromStartOfDay: true, graceMs: 0 };
  it("admits a visitor arriving before the scheduled time on the scheduled day", () => {
    expect(evaluateCheckInWindow(at("2030-06-10T03:00:00.000Z"), FROM, UNTIL, policy).ok).toBe(true); // 08:30 IST
    expect(evaluateCheckInWindow(at("2030-06-09T18:30:00.000Z"), FROM, UNTIL, policy).ok).toBe(true); // 00:00 IST
  });
  it("still refuses the previous day", () => {
    const r = evaluateCheckInWindow(at("2030-06-09T18:29:59.999Z"), FROM, UNTIL, policy);
    expect(r).toMatchObject({ ok: false, code: "PASS_NOT_YET_VALID" });
  });
  it("does not extend the end of validity", () => {
    expect(evaluateCheckInWindow(at("2030-06-10T18:30:00.000Z"), FROM, UNTIL, policy)).toMatchObject({ ok: false, code: "PASS_EXPIRED" });
  });
});

describe("evaluateCheckInWindow - expiry grace", () => {
  const policy = { fromStartOfDay: false, graceMs: 30 * 60_000 };
  it("admits within the grace period after validUntil", () => {
    expect(evaluateCheckInWindow(at("2030-06-10T18:59:00.000Z"), FROM, UNTIL, policy).ok).toBe(true);
  });
  it("refuses beyond the grace period (an expired pass stays refused)", () => {
    const r = evaluateCheckInWindow(at("2030-06-10T19:00:00.001Z"), FROM, UNTIL, policy);
    expect(r).toMatchObject({ ok: false, code: "PASS_EXPIRED" });
    expect((r as { message: string }).message).toContain("30 min grace");
  });
  it("grace never opens the window early", () => {
    expect(evaluateCheckInWindow(at("2030-06-10T04:00:00.000Z"), FROM, UNTIL, policy).ok).toBe(false);
  });
});

describe("checkInWindowBounds", () => {
  it("strict policy leaves the stored window untouched", () => {
    const b = checkInWindowBounds(FROM, UNTIL, STRICT_WINDOW_POLICY);
    expect(b.opensAt).toEqual(FROM);
    expect(b.closesAt).toEqual(UNTIL);
  });
});
