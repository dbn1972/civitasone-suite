/**
 * Unit tests — notice-period enforcement domain logic (Gap 3).
 *
 * Pure/deterministic: computeNoticeDays + validateNoticePeriod. A configured minimum notice is
 * enforced on draft→scheduled; a short-notice scheduling is rejected (MEETING_SHORT_NOTICE) unless
 * explicitly waived; an unconfigured notice period preserves existing behavior.
 */
import { describe, it, expect } from "vitest";
import { computeNoticeDays, validateNoticePeriod, type TransitionContext } from "../src/modules/meeting-core/domain.js";

const NOW = new Date("2026-07-12T00:00:00Z");
function daysFromNow(n: number): Date {
  return new Date(NOW.getTime() + n * 86_400_000);
}
function ctx(partial: Partial<TransitionContext>): TransitionContext {
  return { now: NOW, ...partial };
}

describe("computeNoticeDays", () => {
  it("floors whole days of notice and never goes negative", () => {
    expect(computeNoticeDays(NOW, daysFromNow(10))).toBe(10);
    expect(computeNoticeDays(NOW, daysFromNow(0))).toBe(0);
    expect(computeNoticeDays(NOW, new Date(NOW.getTime() - 86_400_000))).toBe(0);
  });
});

describe("validateNoticePeriod (Gap 3)", () => {
  it("passes when notice meets the configured minimum", () => {
    expect(() => validateNoticePeriod(ctx({ noticePeriodDays: 7, scheduledAt: daysFromNow(10) }))).not.toThrow();
  });

  it("rejects a short-notice schedule with MEETING_SHORT_NOTICE (422)", () => {
    let code: string | undefined;
    let status: number | undefined;
    let details: Record<string, unknown> | undefined;
    try {
      validateNoticePeriod(ctx({ noticePeriodDays: 7, scheduledAt: daysFromNow(3) }));
    } catch (e) {
      code = (e as { code?: string }).code;
      status = (e as { status?: number }).status;
      details = (e as { details?: Record<string, unknown> }).details;
    }
    expect(code).toBe("MEETING_SHORT_NOTICE");
    expect(status).toBe(422);
    expect(details).toMatchObject({ requiredNoticeDays: 7, actualNoticeDays: 3 });
  });

  it("allows a short-notice schedule when an explicit waiver is supplied", () => {
    expect(() =>
      validateNoticePeriod(ctx({ noticePeriodDays: 7, scheduledAt: daysFromNow(3), shortNoticeWaiver: true })),
    ).not.toThrow();
  });

  it("is a no-op when no notice period is configured (behavior-preserving)", () => {
    expect(() => validateNoticePeriod(ctx({ scheduledAt: daysFromNow(0) }))).not.toThrow();
    expect(() => validateNoticePeriod(ctx({ noticePeriodDays: 0, scheduledAt: daysFromNow(0) }))).not.toThrow();
  });
});
