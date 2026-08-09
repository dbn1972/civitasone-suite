/**
 * Loyalty Service — Tiers Domain: Comprehensive evaluation tests.
 *
 * Tests tier evaluation (upgrade/downgrade/none), grace period protection,
 * tier expiry, edge cases (no tiers, bigint thresholds).
 *
 * Source: modules/tiers/domain.ts
 */
import { describe, it, expect } from "vitest";
import { evaluateTier, isInGracePeriod, isTierExpired, type TierDef } from "../src/modules/tiers/domain.js";

const TIERS: TierDef[] = [
  { id: "bronze", name: "Bronze", level: 1, minPointsThreshold: 0n },
  { id: "silver", name: "Silver", level: 2, minPointsThreshold: 1000n },
  { id: "gold", name: "Gold", level: 3, minPointsThreshold: 5000n },
  { id: "platinum", name: "Platinum", level: 4, minPointsThreshold: 20000n },
];

describe("evaluateTier — tier progression", () => {
  it("0 points → Bronze (lowest)", () => {
    const r = evaluateTier(0n, TIERS, null);
    expect(r.newTierName).toBe("Bronze");
    expect(r.newLevel).toBe(1);
  });

  it("1000 points → Silver", () => {
    const r = evaluateTier(1000n, TIERS, null);
    expect(r.newTierName).toBe("Silver");
    expect(r.newLevel).toBe(2);
  });

  it("5000 points → Gold", () => {
    const r = evaluateTier(5000n, TIERS, null);
    expect(r.newTierName).toBe("Gold");
  });

  it("20000 points → Platinum", () => {
    const r = evaluateTier(20000n, TIERS, null);
    expect(r.newTierName).toBe("Platinum");
    expect(r.newLevel).toBe(4);
  });

  it("999 points → Bronze (just below Silver threshold)", () => {
    expect(evaluateTier(999n, TIERS, null).newTierName).toBe("Bronze");
  });

  it("upgrade detected: Bronze → Silver", () => {
    const r = evaluateTier(1500n, TIERS, "bronze");
    expect(r.changed).toBe(true);
    expect(r.direction).toBe("upgrade");
    expect(r.newTierId).toBe("silver");
  });

  it("downgrade detected: Gold → Silver", () => {
    const r = evaluateTier(2000n, TIERS, "gold");
    expect(r.changed).toBe(true);
    expect(r.direction).toBe("downgrade");
    expect(r.newTierId).toBe("silver");
  });

  it("no change when staying in same tier", () => {
    const r = evaluateTier(3000n, TIERS, "silver");
    expect(r.changed).toBe(false);
    expect(r.direction).toBe("none");
  });

  it("first evaluation from null → upgrade", () => {
    const r = evaluateTier(5000n, TIERS, null);
    expect(r.changed).toBe(true);
    expect(r.direction).toBe("upgrade");
  });

  it("empty tier list → base tier", () => {
    const r = evaluateTier(10000n, [], null);
    expect(r.newTierName).toBe("base");
    expect(r.newLevel).toBe(0);
    expect(r.changed).toBe(false);
  });

  it("large bigint points work correctly", () => {
    const r = evaluateTier(999999999n, TIERS, "gold");
    expect(r.newTierName).toBe("Platinum");
    expect(r.direction).toBe("upgrade");
  });
});

describe("isInGracePeriod — downgrade protection", () => {
  it("true when within grace days", () => {
    const upgraded = new Date("2026-07-01");
    const now = new Date("2026-07-15"); // 14 days < 30 days grace
    expect(isInGracePeriod(upgraded, 30, now)).toBe(true);
  });

  it("false when grace period expired", () => {
    const upgraded = new Date("2026-07-01");
    const now = new Date("2026-08-15"); // 45 days > 30 days grace
    expect(isInGracePeriod(upgraded, 30, now)).toBe(false);
  });

  it("false when no last upgrade date (null)", () => {
    expect(isInGracePeriod(null, 30)).toBe(false);
  });

  it("false when grace period is 0 or negative", () => {
    expect(isInGracePeriod(new Date("2026-07-01"), 0)).toBe(false);
    expect(isInGracePeriod(new Date("2026-07-01"), -5)).toBe(false);
  });

  it("boundary: exactly at grace end (day 30) is NOT in grace", () => {
    const upgraded = new Date("2026-07-01T00:00:00Z");
    const now = new Date("2026-07-31T00:00:00Z"); // exactly 30 days
    expect(isInGracePeriod(upgraded, 30, now)).toBe(false);
  });
});

describe("isTierExpired", () => {
  it("false when no expiry (null)", () => expect(isTierExpired(null)).toBe(false));
  it("false when undefined", () => expect(isTierExpired(undefined)).toBe(false));
  it("true when past expiry", () => expect(isTierExpired(new Date("2020-01-01"))).toBe(true));
  it("false when future expiry", () => expect(isTierExpired(new Date("2099-01-01"))).toBe(false));
  it("true at exact expiry moment", () => {
    const expiry = new Date("2026-07-01T00:00:00Z");
    const now = new Date("2026-07-01T00:00:01Z"); // 1 second after
    expect(isTierExpired(expiry, now)).toBe(true);
  });
});
