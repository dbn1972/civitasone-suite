/**
 * location/domain.ts — coverage gap: isOverCapacityThreshold,
 * assertWithinCapacity, and isWithinBusinessHours had ZERO test invocations
 * anywhere in the suite prior to this file (isAreaPermitted and
 * isLocationScopeValid, the other two exports, are already covered inside
 * tests/domain-comprehensive.test.ts's "check-in/domain" describe block —
 * confirmed via `grep -n 'isOverCapacityThreshold(\|assertWithinCapacity(\|
 * isWithinBusinessHours(' tests/*.test.ts` returning no matches before this
 * file was added).
 *
 * Also documents a real functional gap found during audit: capacity
 * enforcement is alert-only, not preventive, despite this module's own
 * doc comment. `assertWithinCapacity` (the throwing/enforcing variant) is
 * defined here but is NEVER called anywhere in the service (confirmed via
 * `grep -rn 'assertWithinCapacity' src/` matching only its own definition) —
 * it is dead code. Only `isOverCapacityThreshold` (the boolean predicate) is
 * used, exclusively in modules/check-in/consumer.ts, and only AFTER the
 * check-in transaction has already committed (that file's own comment:
 * "capacity-threshold check AFTER commit"), purely to fire a
 * `capacityThresholdReached` alert event. So a location's configured
 * `capacityThreshold` never actually blocks a check-in — Property 28's
 * "new check-ins rejected until occupancy drops below threshold" (this
 * file's own JSDoc on assertWithinCapacity) describes behavior the codebase
 * does not currently wire up anywhere. The tests below prove
 * assertWithinCapacity itself behaves correctly in isolation — valuable
 * coverage regardless, and immediately useful the day someone wires it into
 * an actual pre-commit capacity check — while the dead-code/alert-only gap
 * is a business-logic finding for the audit report, not something a unit
 * test can assert on its own.
 */
import { describe, expect, it } from "vitest";
import {
  DomainError,
  assertWithinCapacity,
  isAreaPermitted,
  isOverCapacityThreshold,
  isWithinBusinessHours,
} from "../src/modules/location/domain.js";
import type { BusinessHours } from "../src/modules/location/schema.js";

describe("isOverCapacityThreshold (Property 28)", () => {
  it("false when occupancy is below the threshold", () => {
    expect(isOverCapacityThreshold(449, 450)).toBe(false);
  });

  it("true when occupancy exactly equals the threshold (>=, not strictly >)", () => {
    // The doc comment is explicit: "so the check-in that would push
    // occupancy to the threshold is itself rejected" — equality must count.
    expect(isOverCapacityThreshold(450, 450)).toBe(true);
  });

  it("true when occupancy exceeds the threshold", () => {
    expect(isOverCapacityThreshold(451, 450)).toBe(true);
  });

  it("true at zero threshold with zero occupancy (edge case: a location configured with no capacity at all)", () => {
    expect(isOverCapacityThreshold(0, 0)).toBe(true);
  });
});

describe("assertWithinCapacity (Property 28) — currently unused in production (see file header), but correct in isolation", () => {
  it("does not throw when comfortably under threshold", () => {
    expect(() => assertWithinCapacity(100, 450)).not.toThrow();
  });

  it("throws CAPACITY_EXCEEDED at the threshold boundary", () => {
    expect(() => assertWithinCapacity(450, 450)).toThrow(DomainError);
    try {
      assertWithinCapacity(450, 450);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("CAPACITY_EXCEEDED");
    }
  });

  it("throws CAPACITY_EXCEEDED when over threshold", () => {
    expect(() => assertWithinCapacity(500, 450)).toThrow(DomainError);
  });

  it("error message reports both the current occupancy and the configured threshold", () => {
    try {
      assertWithinCapacity(500, 450);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain("500");
      expect((err as Error).message).toContain("450");
    }
  });
});

describe("isWithinBusinessHours", () => {
  const allWeekOpen: BusinessHours = {
    mon: { open: "09:00", close: "18:00" },
    tue: { open: "09:00", close: "18:00" },
    wed: { open: "09:00", close: "18:00" },
    thu: { open: "09:00", close: "18:00" },
    fri: { open: "09:00", close: "18:00" },
    sat: null,
    sun: { open: "10:00", close: "14:00", closed: true },
  };

  it("true for a time within the day's open/close window", () => {
    // 2026-08-24 is a Monday.
    expect(isWithinBusinessHours(allWeekOpen, new Date("2026-08-24T10:00:00"))).toBe(true);
  });

  it("false exactly at the close boundary (checkMinutes < closeMinutes, not <=)", () => {
    expect(isWithinBusinessHours(allWeekOpen, new Date("2026-08-24T18:00:00"))).toBe(false);
  });

  it("true exactly at the open boundary (checkMinutes >= openMinutes)", () => {
    expect(isWithinBusinessHours(allWeekOpen, new Date("2026-08-24T09:00:00"))).toBe(true);
  });

  it("false before opening", () => {
    expect(isWithinBusinessHours(allWeekOpen, new Date("2026-08-24T08:59:00"))).toBe(false);
  });

  it("false for a day with a null entry (no hours configured at all)", () => {
    // 2026-08-22 is a Saturday.
    expect(isWithinBusinessHours(allWeekOpen, new Date("2026-08-22T12:00:00"))).toBe(false);
  });

  it("false for a day explicitly marked closed=true, even though open/close times are still present", () => {
    // 2026-08-23 is a Sunday.
    expect(isWithinBusinessHours(allWeekOpen, new Date("2026-08-23T12:00:00"))).toBe(false);
  });
});

// Existing coverage for isAreaPermitted/isLocationScopeValid lives in
// tests/domain-comprehensive.test.ts — imported here only to confirm this
// file's import path/module shape stays in sync, not to re-test them.
describe("isAreaPermitted (sanity — full coverage already in domain-comprehensive.test.ts)", () => {
  it("perimeter gate (null areaId) is always permitted", () => {
    expect(isAreaPermitted(null, [])).toBe(true);
  });
});
