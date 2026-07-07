/**
 * Property-Based Test for Limitation Clock Deadline Computation.
 * Uses fast-check to verify invariants hold across all valid inputs.
 *
 * Property 17: Limitation Clock Deadline Computation
 * **Validates: Requirements 10.5**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  computeDeadline,
  scheduleNotifications,
  LimitationDomainError,
} from "../src/modules/limitations/domain.js";

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** A valid filing date: between 2000-01-01 and 2099-12-31, normalized to midnight UTC */
const filingDateArb: fc.Arbitrary<Date> = fc.tuple(
  fc.integer({ min: 2000, max: 2099 }),   // year
  fc.integer({ min: 0, max: 11 }),        // month (0-indexed)
  fc.integer({ min: 1, max: 28 }),        // day (capped at 28 to avoid month overflow)
).map(([year, month, day]) => new Date(Date.UTC(year, month, day)));

/** A valid limitation period in days: 1 to 3650 (up to ~10 years) */
const periodDaysArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 3650 });

/** A small limitation period (less than 30 days) to test alert skipping */
const smallPeriodArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 29 });

/** Helper: add days to a date */
function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Helper: subtract days from a date */
function subtractDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}

// ─── Property Tests ───────────────────────────────────────────────────────────

describe("Property 17: Limitation Clock Deadline Computation", () => {
  /**
   * For any valid filing date and limitation period (in days),
   * the computed deadline must always be exactly `filingDate + limitationPeriod` days.
   *
   * **Validates: Requirements 10.5**
   */
  it("deadline is exactly filingDate + limitationPeriod days", () => {
    fc.assert(
      fc.property(filingDateArb, periodDaysArb, (filingDate, periodDays) => {
        const deadline = computeDeadline(filingDate, periodDays);
        const expected = addDays(filingDate, periodDays);
        expect(deadline.getTime()).toBe(expected.getTime());
      }),
      { numRuns: 500 },
    );
  });

  /**
   * Alert dates must be at 30d, 15d, and 7d before the deadline.
   * When the filing date is far enough in the past (so all alerts are in the future),
   * all three alert dates should be present at the correct offsets.
   *
   * **Validates: Requirements 10.5**
   */
  it("alert dates are at exactly 30d, 15d, and 7d before deadline when all are future", () => {
    fc.assert(
      fc.property(filingDateArb, periodDaysArb, (filingDate, periodDays) => {
        // Ensure period is large enough that all alerts are after filing date
        if (periodDays <= 30) return; // skip; handled by separate property

        const deadline = computeDeadline(filingDate, periodDays);
        // Set currentDate well before any alert to ensure all are included
        const currentDate = subtractDays(deadline, 31);

        const alerts = scheduleNotifications(deadline, currentDate);

        // All three alerts should be present
        expect(alerts.at30d).toBeDefined();
        expect(alerts.at15d).toBeDefined();
        expect(alerts.at7d).toBeDefined();

        // Verify exact positions
        const expected30d = subtractDays(deadline, 30);
        const expected15d = subtractDays(deadline, 15);
        const expected7d = subtractDays(deadline, 7);

        expect(alerts.at30d!.getTime()).toBe(expected30d.getTime());
        expect(alerts.at15d!.getTime()).toBe(expected15d.getTime());
        expect(alerts.at7d!.getTime()).toBe(expected7d.getTime());
      }),
      { numRuns: 500 },
    );
  });

  /**
   * Alert dates must always be chronologically ordered:
   * 30d alert < 15d alert < 7d alert < deadline.
   *
   * **Validates: Requirements 10.5**
   */
  it("alert dates are chronologically ordered (30d < 15d < 7d < deadline)", () => {
    fc.assert(
      fc.property(filingDateArb, periodDaysArb, (filingDate, periodDays) => {
        if (periodDays <= 30) return; // need all alerts present

        const deadline = computeDeadline(filingDate, periodDays);
        const currentDate = subtractDays(deadline, 31);
        const alerts = scheduleNotifications(deadline, currentDate);

        // Chronological ordering
        expect(alerts.at30d!.getTime()).toBeLessThan(alerts.at15d!.getTime());
        expect(alerts.at15d!.getTime()).toBeLessThan(alerts.at7d!.getTime());
        expect(alerts.at7d!.getTime()).toBeLessThan(deadline.getTime());
      }),
      { numRuns: 500 },
    );
  });

  /**
   * If limitationPeriod < 30, some alerts may be skipped (but those that remain are still valid).
   * Specifically, any alert date that would fall before the filing date should be absent.
   *
   * **Validates: Requirements 10.5**
   */
  it("short periods may skip alerts, but remaining alerts are still valid", () => {
    fc.assert(
      fc.property(filingDateArb, smallPeriodArb, (filingDate, periodDays) => {
        const deadline = computeDeadline(filingDate, periodDays);
        // Use filingDate as currentDate to check which alerts are schedulable
        const currentDate = filingDate;
        const alerts = scheduleNotifications(deadline, currentDate);

        // For a period < 30, the 30d alert would be before the filing date
        // Verify: if an alert IS present, it's at the correct offset from deadline
        if (alerts.at30d) {
          const expected30d = subtractDays(deadline, 30);
          expect(alerts.at30d.getTime()).toBe(expected30d.getTime());
          // And it must be after the currentDate (filingDate)
          expect(alerts.at30d.getTime()).toBeGreaterThan(currentDate.getTime());
        }
        if (alerts.at15d) {
          const expected15d = subtractDays(deadline, 15);
          expect(alerts.at15d.getTime()).toBe(expected15d.getTime());
          expect(alerts.at15d.getTime()).toBeGreaterThan(currentDate.getTime());
        }
        if (alerts.at7d) {
          const expected7d = subtractDays(deadline, 7);
          expect(alerts.at7d.getTime()).toBe(expected7d.getTime());
          expect(alerts.at7d.getTime()).toBeGreaterThan(currentDate.getTime());
        }

        // With period < 30, the 30d alert is always before filing date, so it should be absent
        // (since deadline - 30 < filingDate when periodDays < 30)
        if (periodDays < 30) {
          expect(alerts.at30d).toBeUndefined();
        }
        // With period < 15, 15d alert is also before filing date
        if (periodDays < 15) {
          expect(alerts.at15d).toBeUndefined();
        }
        // With period < 7, 7d alert is also before filing date
        if (periodDays < 7) {
          expect(alerts.at7d).toBeUndefined();
        }
      }),
      { numRuns: 300 },
    );
  });

  /**
   * No alert date should be before the filing date.
   * This ensures all scheduled notifications are actionable (after the case is filed).
   *
   * **Validates: Requirements 10.5**
   */
  it("no alert date is before the filing date", () => {
    fc.assert(
      fc.property(filingDateArb, periodDaysArb, (filingDate, periodDays) => {
        const deadline = computeDeadline(filingDate, periodDays);
        // Use filing date as currentDate — we want to see all alerts that
        // would be scheduled at the time of filing
        const currentDate = filingDate;
        const alerts = scheduleNotifications(deadline, currentDate);

        if (alerts.at30d) {
          expect(alerts.at30d.getTime()).toBeGreaterThan(filingDate.getTime());
        }
        if (alerts.at15d) {
          expect(alerts.at15d.getTime()).toBeGreaterThan(filingDate.getTime());
        }
        if (alerts.at7d) {
          expect(alerts.at7d.getTime()).toBeGreaterThan(filingDate.getTime());
        }
      }),
      { numRuns: 500 },
    );
  });

  /**
   * The deadline is always strictly after the filing date.
   * Since periodDays must be > 0 (enforced by domain), this must always hold.
   *
   * **Validates: Requirements 10.5**
   */
  it("deadline is always strictly after the filing date", () => {
    fc.assert(
      fc.property(filingDateArb, periodDaysArb, (filingDate, periodDays) => {
        const deadline = computeDeadline(filingDate, periodDays);
        expect(deadline.getTime()).toBeGreaterThan(filingDate.getTime());
      }),
      { numRuns: 500 },
    );
  });

  /**
   * computeDeadline rejects non-positive periods (zero or negative).
   * This validates the domain invariant that limitation periods must be positive.
   *
   * **Validates: Requirements 10.5**
   */
  it("rejects zero or negative limitation periods", () => {
    const nonPositiveArb = fc.integer({ min: -1000, max: 0 });
    fc.assert(
      fc.property(filingDateArb, nonPositiveArb, (filingDate, invalidPeriod) => {
        expect(() => computeDeadline(filingDate, invalidPeriod)).toThrow(LimitationDomainError);
      }),
      { numRuns: 200 },
    );
  });
});
