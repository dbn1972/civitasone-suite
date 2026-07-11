/**
 * meeting-service — tenure expiry property-based test (task 21.2, P11).
 *
 * **Property 11: Tenure expiry notification** — members within 30 days of
 * tenure_end must have tenure_expiring event emitted (classified as "expiring");
 * those beyond the window are classified as "none".
 *
 * Uses fast-check to generate random tenure_end dates relative to today and
 * verifies the pure `classifyTenure` function from `src/workers/tenure-expiry.ts`
 * correctly classifies:
 *   - "expiring" when 0 < daysUntil <= 30
 *   - "expired" when daysUntil <= 0
 *   - "none" when daysUntil > 30 or tenure_end is null
 *
 * **Validates: Requirements 2.4**
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  classifyTenure,
  planTenureActions,
  addDaysIso,
  DEFAULT_ADVANCE_NOTICE_DAYS,
  type MembershipRow,
} from "../src/workers/tenure-expiry.js";

// ─── Custom arbitraries ─────────────────────────────────────────────────────────

/** Generate a "today" ISO date within a reasonable range (2024–2028). */
const arbToday = fc
  .integer({ min: 0, max: 1826 }) // days from 2024-01-01 (≈5 years span)
  .map((dayOffset) => {
    const d = new Date("2024-01-01T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + dayOffset);
    return d.toISOString().slice(0, 10);
  });

/** Generate an offset in days for tenure_end relative to today (-365 to +365). */
const arbOffset = fc.integer({ min: -365, max: 365 });

/** Generate a custom advance-notice window (1 to 90 days). */
const arbWindow = fc.integer({ min: 1, max: 90 });

/** Generate a UUID-like string for membership row construction. */
const arbUuid = fc.uuid();

/** Build a MembershipRow from generated values. */
function makeMembershipRow(
  id: string,
  tenantId: string,
  committeeId: string,
  memberId: string,
  tenureEnd: string,
): MembershipRow {
  return {
    id,
    tenantId,
    committeeId,
    memberId,
    tenureEnd,
    version: 1,
    status: "active",
  };
}

// ─── P11: Tenure expiry notification ──────────────────────────────────────────

describe("P11: Tenure expiry notification — classifyTenure (Req 2.4)", () => {
  it("classifies members within 30-day window as 'expiring' (0 < days <= 30)", () => {
    fc.assert(
      fc.property(
        arbToday,
        fc.integer({ min: 1, max: DEFAULT_ADVANCE_NOTICE_DAYS }),
        (today, daysUntil) => {
          const tenureEnd = addDaysIso(today, daysUntil);
          const result = classifyTenure(tenureEnd, today);
          expect(result).toBe("expiring");
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("classifies members beyond the 30-day window as 'none' (days > 30)", () => {
    fc.assert(
      fc.property(
        arbToday,
        fc.integer({ min: DEFAULT_ADVANCE_NOTICE_DAYS + 1, max: 365 }),
        (today, daysUntil) => {
          const tenureEnd = addDaysIso(today, daysUntil);
          const result = classifyTenure(tenureEnd, today);
          expect(result).toBe("none");
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("classifies members on or past tenure_end as 'expired' (days <= 0)", () => {
    fc.assert(
      fc.property(
        arbToday,
        fc.integer({ min: -365, max: 0 }),
        (today, daysUntil) => {
          const tenureEnd = addDaysIso(today, daysUntil);
          const result = classifyTenure(tenureEnd, today);
          expect(result).toBe("expired");
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("classifies null tenure_end (open-ended) as 'none'", () => {
    fc.assert(
      fc.property(arbToday, (today) => {
        expect(classifyTenure(null, today)).toBe("none");
      }),
      { numRuns: 200 },
    );
  });

  it("respects custom advance-notice window boundaries", () => {
    fc.assert(
      fc.property(arbToday, arbWindow, (today, windowDays) => {
        // Exactly at the boundary — should be "expiring"
        const atBoundary = addDaysIso(today, windowDays);
        expect(classifyTenure(atBoundary, today, windowDays)).toBe("expiring");

        // One day beyond boundary — should be "none"
        const beyondBoundary = addDaysIso(today, windowDays + 1);
        expect(classifyTenure(beyondBoundary, today, windowDays)).toBe("none");

        // One day inside boundary — should be "expiring"
        if (windowDays > 1) {
          const insideBoundary = addDaysIso(today, windowDays - 1);
          expect(classifyTenure(insideBoundary, today, windowDays)).toBe("expiring");
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe("P11: planTenureActions emits notices for expiring members (Req 2.4)", () => {
  it("every member in the 30-day window appears in expiringNotices", () => {
    fc.assert(
      fc.property(
        arbToday,
        fc.array(arbOffset, { minLength: 1, maxLength: 20 }),
        fc.array(arbUuid, { minLength: 20, maxLength: 20 }),
        (today, offsets, uuids) => {
          const rows: MembershipRow[] = offsets.map((offset, i) =>
            makeMembershipRow(
              uuids[i] ?? `id-${i}`,
              "tenant-1",
              "committee-1",
              `member-${i}`,
              addDaysIso(today, offset),
            ),
          );

          const plan = planTenureActions(rows, today);

          // Every row in expiringNotices must have 0 < days <= 30
          for (const r of plan.expiringNotices) {
            const days = Math.round(
              (Date.parse(`${r.tenureEnd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
            );
            expect(days).toBeGreaterThan(0);
            expect(days).toBeLessThanOrEqual(DEFAULT_ADVANCE_NOTICE_DAYS);
          }

          // Every row in expiries must have days <= 0
          for (const r of plan.expiries) {
            const days = Math.round(
              (Date.parse(`${r.tenureEnd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
            );
            expect(days).toBeLessThanOrEqual(0);
          }

          // No row is classified into both buckets
          const expiringIds = new Set(plan.expiringNotices.map((r) => r.id));
          for (const r of plan.expiries) {
            expect(expiringIds.has(r.id)).toBe(false);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it("members beyond the 30-day window are excluded from both buckets", () => {
    fc.assert(
      fc.property(
        arbToday,
        fc.array(fc.integer({ min: DEFAULT_ADVANCE_NOTICE_DAYS + 1, max: 365 }), { minLength: 1, maxLength: 10 }),
        fc.array(arbUuid, { minLength: 10, maxLength: 10 }),
        (today, offsets, uuids) => {
          const rows: MembershipRow[] = offsets.map((offset, i) =>
            makeMembershipRow(
              uuids[i] ?? `id-${i}`,
              "tenant-1",
              "committee-1",
              `member-${i}`,
              addDaysIso(today, offset),
            ),
          );

          const plan = planTenureActions(rows, today);

          expect(plan.expiries).toHaveLength(0);
          expect(plan.expiringNotices).toHaveLength(0);
        },
      ),
      { numRuns: 500 },
    );
  });
});
