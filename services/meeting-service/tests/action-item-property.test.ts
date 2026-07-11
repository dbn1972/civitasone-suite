/**
 * Action-item module — property-based tests (task 11.4).
 *
 * Properties tested against `src/modules/action-item/domain.ts`:
 *   - P19: Deadline after meeting — action_item.deadline > meeting.actual_start_at
 *   - P20: Escalation monotonicity — escalation_level only increases, never decreases
 *   - P21: Overdue correctness — status==overdue IFF deadline < now AND status NOT IN
 *     (completed, verified, withdrawn)
 *   - P22: Evidence before verification — status==verified requires evidence_url OR
 *     evidence_note present
 *
 * Uses fast-check (fc.property / fc.assert) with random dates, statuses, and levels.
 *
 * **Validates: Requirements 9.1, 9.5, 9.6, 9.7**
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { HttpError } from "../src/shared/context.js";
import {
  ACTION_ITEM_STATUSES,
  SETTLED_STATUSES,
  isDeadlineAfterMeetingStart,
  assertDeadlineAfterMeetingStart,
  resolveEscalationState,
  assertEscalationMonotonic,
  computeEscalationLevel,
  DEFAULT_ESCALATION_CHAIN,
  isOverdue,
  isSettledStatus,
  hasEvidence,
  assertEvidenceBeforeVerification,
  type ActionItemStatus,
} from "../src/modules/action-item/domain.js";

// ─── Custom arbitraries ─────────────────────────────────────────────────────────

/** Generate a Date within a reasonable range (2020–2030). */
const arbDate = fc.date({ min: new Date("2020-01-01T00:00:00Z"), max: new Date("2030-12-31T23:59:59Z") });

/** Generate a valid ActionItemStatus. */
const arbStatus = fc.constantFrom(...ACTION_ITEM_STATUSES);

/** Generate an escalation level (0–3, matching the default chain). */
const arbEscalationLevel = fc.integer({ min: 0, max: 3 });

/** Generate a non-empty trimmed string (for evidence). */
const arbNonEmptyString = fc.string({ minLength: 1 }).map((s) => s.trim() || "x");

/** Generate an optional evidence string (null, empty, whitespace, or non-empty). */
const arbEvidenceField = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(""),
  fc.constant("   "),
  arbNonEmptyString,
);

// ─── P19: Deadline after meeting ────────────────────────────────────────────────

describe("P19: Deadline after meeting (action_item.deadline > meeting.actual_start_at)", () => {
  it("isDeadlineAfterMeetingStart returns true IFF deadline > actualStartAt (or start is null)", () => {
    fc.assert(
      fc.property(arbDate, arbDate, (deadline, startAt) => {
        const result = isDeadlineAfterMeetingStart(deadline, startAt);
        const expected = deadline.getTime() > startAt.getTime();
        expect(result).toBe(expected);
      }),
      { numRuns: 1000 },
    );
  });

  it("isDeadlineAfterMeetingStart is vacuously true when actualStartAt is null/undefined", () => {
    fc.assert(
      fc.property(arbDate, (deadline) => {
        expect(isDeadlineAfterMeetingStart(deadline, null)).toBe(true);
        expect(isDeadlineAfterMeetingStart(deadline, undefined)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("assertDeadlineAfterMeetingStart throws when deadline <= actualStartAt", () => {
    fc.assert(
      fc.property(arbDate, fc.integer({ min: 0, max: 86_400_000 }), (startAt, offsetMs) => {
        // Deadline at or before the meeting start
        const deadlineAtOrBefore = new Date(startAt.getTime() - offsetMs);
        if (deadlineAtOrBefore.getTime() <= startAt.getTime()) {
          expect(() => assertDeadlineAfterMeetingStart(deadlineAtOrBefore, startAt)).toThrow(HttpError);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("assertDeadlineAfterMeetingStart does not throw when deadline > actualStartAt", () => {
    fc.assert(
      fc.property(arbDate, fc.integer({ min: 1, max: 365 * 24 * 3_600_000 }), (startAt, offsetMs) => {
        const deadlineAfter = new Date(startAt.getTime() + offsetMs);
        fc.pre(!isNaN(deadlineAfter.getTime()));
        expect(() => assertDeadlineAfterMeetingStart(deadlineAfter, startAt)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });
});

// ─── P20: Escalation monotonicity ──────────────────────────────────────────────

describe("P20: Escalation monotonicity (escalation_level only increases, never decreases)", () => {
  it("resolveEscalationState.level is always >= currentLevel (monotonic)", () => {
    fc.assert(
      fc.property(arbDate, arbEscalationLevel, arbDate, (deadline, currentLevel, now) => {
        const state = resolveEscalationState({ deadline, currentLevel, now });
        // P20: level never decreases
        expect(state.level).toBeGreaterThanOrEqual(currentLevel);
      }),
      { numRuns: 1000 },
    );
  });

  it("assertEscalationMonotonic throws when toLevel < fromLevel", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 0, max: 2 }),
        (fromLevel, offset) => {
          const toLevel = fromLevel - 1 - offset; // always less than fromLevel
          if (toLevel < 0) return; // skip invalid cases
          expect(() => assertEscalationMonotonic(fromLevel, toLevel)).toThrow(HttpError);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("assertEscalationMonotonic does not throw when toLevel >= fromLevel", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
        (fromLevel, toLevel) => {
          fc.pre(toLevel >= fromLevel);
          expect(() => assertEscalationMonotonic(fromLevel, toLevel)).not.toThrow();
        },
      ),
      { numRuns: 500 },
    );
  });

  it("successive escalation evaluations at increasing times never decrease the level", () => {
    fc.assert(
      fc.property(
        arbDate,
        fc.array(fc.integer({ min: 0, max: 30 * 24 }), { minLength: 2, maxLength: 20 }),
        (deadline, hourOffsets) => {
          // Sort offsets to simulate forward-moving time
          const sorted = [...hourOffsets].sort((a, b) => a - b);
          let currentLevel = 0;
          for (const offset of sorted) {
            const now = new Date(deadline.getTime() + offset * 3_600_000);
            const state = resolveEscalationState({ deadline, currentLevel, now });
            // P20: level can only go up or stay the same
            expect(state.level).toBeGreaterThanOrEqual(currentLevel);
            currentLevel = state.level;
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it("computeEscalationLevel is monotonically non-decreasing with advancing time", () => {
    fc.assert(
      fc.property(
        arbDate,
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 1, max: 500 }),
        (deadline, hours1, delta) => {
          const now1 = new Date(deadline.getTime() + hours1 * 3_600_000);
          const now2 = new Date(deadline.getTime() + (hours1 + delta) * 3_600_000);
          const level1 = computeEscalationLevel(deadline, now1);
          const level2 = computeEscalationLevel(deadline, now2);
          expect(level2).toBeGreaterThanOrEqual(level1);
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ─── P21: Overdue correctness ──────────────────────────────────────────────────

describe("P21: Overdue correctness (status==overdue IFF deadline < now AND status NOT IN settled)", () => {
  it("isOverdue returns true IFF deadline < now AND status is not settled", () => {
    fc.assert(
      fc.property(arbDate, arbStatus, arbDate, (deadline, status, now) => {
        const result = isOverdue({ deadline, status, now });
        const deadlinePassed = deadline.getTime() < now.getTime();
        const settled = isSettledStatus(status);
        const expected = deadlinePassed && !settled;
        expect(result).toBe(expected);
      }),
      { numRuns: 2000 },
    );
  });

  it("settled statuses are never overdue regardless of deadline", () => {
    fc.assert(
      fc.property(
        arbDate,
        fc.constantFrom(...SETTLED_STATUSES),
        arbDate,
        (deadline, status, now) => {
          expect(isOverdue({ deadline, status, now })).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("non-settled statuses with a future deadline are never overdue", () => {
    const nonSettledStatuses = ACTION_ITEM_STATUSES.filter((s) => !isSettledStatus(s));
    fc.assert(
      fc.property(
        fc.constantFrom(...nonSettledStatuses),
        arbDate,
        fc.integer({ min: 1, max: 365 * 24 * 3_600_000 }),
        (status, now, futureOffsetMs) => {
          const deadline = new Date(now.getTime() + futureOffsetMs);
          expect(isOverdue({ deadline, status, now })).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("non-settled statuses with a past deadline are always overdue", () => {
    const nonSettledStatuses = ACTION_ITEM_STATUSES.filter((s) => !isSettledStatus(s));
    fc.assert(
      fc.property(
        fc.constantFrom(...nonSettledStatuses),
        arbDate,
        fc.integer({ min: 1, max: 365 * 24 * 3_600_000 }),
        (status, now, pastOffsetMs) => {
          const deadline = new Date(now.getTime() - pastOffsetMs);
          fc.pre(!isNaN(deadline.getTime()));
          expect(isOverdue({ deadline, status, now })).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ─── P22: Evidence before verification ─────────────────────────────────────────

describe("P22: Evidence before verification (status==verified requires evidence_url OR evidence_note)", () => {
  it("hasEvidence returns true IFF at least one of evidenceUrl or evidenceNote is a non-empty trimmed string", () => {
    fc.assert(
      fc.property(arbEvidenceField, arbEvidenceField, (url, note) => {
        const result = hasEvidence({ evidenceUrl: url, evidenceNote: note });
        const urlPresent = Boolean(url && url.trim());
        const notePresent = Boolean(note && note.trim());
        expect(result).toBe(urlPresent || notePresent);
      }),
      { numRuns: 1000 },
    );
  });

  it("assertEvidenceBeforeVerification throws when no evidence is present", () => {
    const noEvidenceArbs = [
      { evidenceUrl: null, evidenceNote: null },
      { evidenceUrl: undefined, evidenceNote: undefined },
      { evidenceUrl: "", evidenceNote: "" },
      { evidenceUrl: "   ", evidenceNote: "   " },
      { evidenceUrl: null, evidenceNote: "" },
      { evidenceUrl: "", evidenceNote: null },
    ];
    for (const item of noEvidenceArbs) {
      expect(() => assertEvidenceBeforeVerification(item)).toThrow(HttpError);
    }
  });

  it("assertEvidenceBeforeVerification does NOT throw when evidence is present", () => {
    fc.assert(
      fc.property(
        fc.oneof(arbNonEmptyString, fc.constant(null)),
        fc.oneof(arbNonEmptyString, fc.constant(null)),
        (url, note) => {
          // At least one must be non-empty
          fc.pre(Boolean((url && url.trim()) || (note && note.trim())));
          expect(() =>
            assertEvidenceBeforeVerification({ evidenceUrl: url, evidenceNote: note }),
          ).not.toThrow();
        },
      ),
      { numRuns: 500 },
    );
  });

  it("hasEvidence is false for all-empty combinations (property)", () => {
    // Generate whitespace-only strings of varying lengths
    const arbWhitespace = fc.integer({ min: 0, max: 10 }).map((n) => " ".repeat(n));
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(null as string | null | undefined), fc.constant(undefined as string | null | undefined), fc.constant("" as string | null | undefined), arbWhitespace.map((s) => s as string | null | undefined)),
        fc.oneof(fc.constant(null as string | null | undefined), fc.constant(undefined as string | null | undefined), fc.constant("" as string | null | undefined), arbWhitespace.map((s) => s as string | null | undefined)),
        (url, note) => {
          expect(hasEvidence({ evidenceUrl: url, evidenceNote: note })).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });
});
