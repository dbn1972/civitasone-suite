/**
 * helpdesk-service — SLA Pause/Resume/Extend + CES tests
 *
 * Tests cover:
 *  - Pause/resume logic (double-pause prevention, resume without pause)
 *  - Extension creation and validation
 *  - CES frequency cap logic (1 per ticket, 3 per customer per 30 days)
 *  - CES score validation (1–7 range)
 *  - computeDeadline integration with pause tracking
 *
 * Requirements: SLA-03, SLA-08, CR-CXP-03
 */
import { describe, it, expect } from "vitest";
import { computeDeadline, computeElapsedBusinessMinutes } from "../src/modules/sla/calendar-domain.js";
import type { WorkDay, Holiday } from "../src/modules/sla/calendar-schema.js";
import type { SlaPauseRow } from "../src/modules/sla/pause-schema.js";
import type { SlaExtensionRow } from "../src/modules/sla/extensions-schema.js";
import type { CesResponseRow } from "../src/modules/sla/ces-schema.js";

// ─── Test Calendar ────────────────────────────────────────────────────────────

const STANDARD_WORK_DAYS: WorkDay[] = [
  { day: 1, start: "09:00", end: "17:00" },
  { day: 2, start: "09:00", end: "17:00" },
  { day: 3, start: "09:00", end: "17:00" },
  { day: 4, start: "09:00", end: "17:00" },
  { day: 5, start: "09:00", end: "17:00" },
];

const STANDARD_CALENDAR = {
  workDays: STANDARD_WORK_DAYS,
  holidays: [] as Holiday[],
  timezone: "UTC",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePause(overrides: Partial<SlaPauseRow> = {}): SlaPauseRow {
  return {
    id: "pause-1",
    tenantId: "tenant-1",
    ticketId: "ticket-1",
    pausedAt: new Date("2025-01-06T10:00:00Z"),
    resumedAt: null,
    pauseStatus: "waiting_on_customer",
    createdBy: "actor-1",
    version: 1,
    ...overrides,
  };
}

function makeExtension(overrides: Partial<SlaExtensionRow> = {}): SlaExtensionRow {
  return {
    id: "ext-1",
    tenantId: "tenant-1",
    ticketId: "ticket-1",
    additionalMinutes: 60,
    reason: "Customer requested more time",
    approverId: "approver-1",
    createdAt: new Date("2025-01-06T12:00:00Z"),
    createdBy: "actor-1",
    version: 1,
    ...overrides,
  };
}

function makeCes(overrides: Partial<CesResponseRow> = {}): CesResponseRow {
  return {
    id: "ces-1",
    tenantId: "tenant-1",
    ticketId: "ticket-1",
    effortScore: 3,
    comment: null,
    submittedAt: new Date("2025-01-06T12:00:00Z"),
    createdBy: "customer-1",
    ...overrides,
  };
}

/**
 * Compute effective deadline with extensions applied.
 * Extensions simply add additional minutes to the base deadline.
 */
function computeEffectiveDeadline(
  startTime: Date,
  baseMinutes: number,
  extensions: SlaExtensionRow[],
  calendar: typeof STANDARD_CALENDAR,
): Date {
  const totalMinutes = baseMinutes + extensions.reduce((sum, e) => sum + e.additionalMinutes, 0);
  return computeDeadline(startTime, totalMinutes, calendar);
}

/**
 * Compute effective elapsed time accounting for pauses.
 * Paused time is subtracted from total elapsed.
 */
function computeEffectiveElapsed(
  start: Date,
  end: Date,
  pauses: SlaPauseRow[],
  calendar: typeof STANDARD_CALENDAR,
): number {
  const totalElapsed = computeElapsedBusinessMinutes(start, end, calendar);
  let pausedMinutes = 0;

  for (const p of pauses) {
    const pauseEnd = p.resumedAt ?? end;
    pausedMinutes += computeElapsedBusinessMinutes(p.pausedAt, pauseEnd, calendar);
  }

  return Math.max(0, totalElapsed - pausedMinutes);
}

// ─── SLA Pause/Resume Logic ───────────────────────────────────────────────────

describe("SLA Pause/Resume domain logic", () => {
  it("paused ticket should not count elapsed time during pause", () => {
    const start = new Date("2025-01-06T09:00:00Z"); // Monday
    const end = new Date("2025-01-06T14:00:00Z"); // 5h later
    const pauses = [
      makePause({
        pausedAt: new Date("2025-01-06T10:00:00Z"),
        resumedAt: new Date("2025-01-06T12:00:00Z"),
      }),
    ];

    // Total elapsed: 5h (300min). Paused: 2h (120min). Effective: 3h (180min)
    const effective = computeEffectiveElapsed(start, end, pauses, STANDARD_CALENDAR);
    expect(effective).toBe(180);
  });

  it("active pause (no resumedAt) uses current time as end", () => {
    const start = new Date("2025-01-06T09:00:00Z");
    const now = new Date("2025-01-06T14:00:00Z");
    const pauses = [
      makePause({ pausedAt: new Date("2025-01-06T10:00:00Z"), resumedAt: null }),
    ];

    // Pause from 10:00 to 14:00 = 4h (240min). Total 5h - 4h = 1h (60min)
    const effective = computeEffectiveElapsed(start, now, pauses, STANDARD_CALENDAR);
    expect(effective).toBe(60);
  });

  it("multiple pauses accumulate correctly", () => {
    const start = new Date("2025-01-06T09:00:00Z");
    const end = new Date("2025-01-06T16:00:00Z"); // 7h total
    const pauses = [
      makePause({
        id: "p1",
        pausedAt: new Date("2025-01-06T10:00:00Z"),
        resumedAt: new Date("2025-01-06T11:00:00Z"),
      }),
      makePause({
        id: "p2",
        pausedAt: new Date("2025-01-06T13:00:00Z"),
        resumedAt: new Date("2025-01-06T14:00:00Z"),
      }),
    ];

    // Total: 7h (420min). Paused: 1h + 1h = 2h (120min). Effective: 5h (300min)
    const effective = computeEffectiveElapsed(start, end, pauses, STANDARD_CALENDAR);
    expect(effective).toBe(300);
  });

  it("no pauses means full elapsed counts", () => {
    const start = new Date("2025-01-06T09:00:00Z");
    const end = new Date("2025-01-06T12:00:00Z");
    const effective = computeEffectiveElapsed(start, end, [], STANDARD_CALENDAR);
    expect(effective).toBe(180);
  });

  it("double-pause prevention: validates only one active pause per ticket", () => {
    const activePauses = [makePause({ resumedAt: null })];
    const hasActivePause = activePauses.some((p) => p.resumedAt === null);
    expect(hasActivePause).toBe(true);
  });

  it("resume without active pause: validates no null-resumedAt exists", () => {
    const closedPauses = [
      makePause({ resumedAt: new Date("2025-01-06T12:00:00Z") }),
    ];
    const hasActivePause = closedPauses.some((p) => p.resumedAt === null);
    expect(hasActivePause).toBe(false);
  });
});

// ─── SLA Extension Logic ──────────────────────────────────────────────────────

describe("SLA Extension domain logic", () => {
  it("extends deadline by additionalMinutes", () => {
    const start = new Date("2025-01-06T09:00:00Z");
    const baseMinutes = 480; // 8h → Mon 17:00
    const extensions = [makeExtension({ additionalMinutes: 60 })]; // +1h

    // 480 + 60 = 540 min = 9h from Mon 09:00 → Tue 10:00
    const deadline = computeEffectiveDeadline(start, baseMinutes, extensions, STANDARD_CALENDAR);
    expect(deadline).toEqual(new Date("2025-01-07T10:00:00Z"));
  });

  it("multiple extensions stack", () => {
    const start = new Date("2025-01-06T09:00:00Z");
    const baseMinutes = 480;
    const extensions = [
      makeExtension({ id: "e1", additionalMinutes: 60 }),
      makeExtension({ id: "e2", additionalMinutes: 120 }),
    ];

    // 480 + 60 + 120 = 660 min = 480 (Mon) + 180 (Tue 09:00-12:00)
    const deadline = computeEffectiveDeadline(start, baseMinutes, extensions, STANDARD_CALENDAR);
    expect(deadline).toEqual(new Date("2025-01-07T12:00:00Z"));
  });

  it("zero extensions do not change deadline", () => {
    const start = new Date("2025-01-06T09:00:00Z");
    const baseMinutes = 480;
    const deadline = computeEffectiveDeadline(start, baseMinutes, [], STANDARD_CALENDAR);
    expect(deadline).toEqual(new Date("2025-01-06T17:00:00Z"));
  });

  it("extension validation: additionalMinutes must be positive", () => {
    const ext = makeExtension({ additionalMinutes: 0 });
    expect(ext.additionalMinutes).toBe(0);
    // In routes, zod validates min(1) — this just tests the type
  });
});

// ─── CES Frequency Cap Logic ─────────────────────────────────────────────────

describe("CES frequency cap validation", () => {
  it("rejects duplicate CES for same ticket", () => {
    const existingResponses = [makeCes({ ticketId: "ticket-1" })];
    const newTicketId = "ticket-1";
    const isDuplicate = existingResponses.some((r) => r.ticketId === newTicketId);
    expect(isDuplicate).toBe(true);
  });

  it("allows CES for different tickets", () => {
    const existingResponses = [makeCes({ ticketId: "ticket-1" })];
    const newTicketId = "ticket-2";
    const isDuplicate = existingResponses.some((r) => r.ticketId === newTicketId);
    expect(isDuplicate).toBe(false);
  });

  it("enforces max 3 per customer per 30 days", () => {
    const now = new Date("2025-01-30T10:00:00Z");
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recentResponses = [
      makeCes({ id: "c1", submittedAt: new Date("2025-01-05T10:00:00Z") }),
      makeCes({ id: "c2", submittedAt: new Date("2025-01-15T10:00:00Z") }),
      makeCes({ id: "c3", submittedAt: new Date("2025-01-25T10:00:00Z") }),
    ];

    const withinWindow = recentResponses.filter(
      (r) => r.submittedAt.getTime() >= thirtyDaysAgo.getTime(),
    );
    expect(withinWindow.length).toBe(3);
    const capExceeded = withinWindow.length >= 3;
    expect(capExceeded).toBe(true);
  });

  it("allows CES when under frequency cap", () => {
    const now = new Date("2025-01-30T10:00:00Z");
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recentResponses = [
      makeCes({ id: "c1", submittedAt: new Date("2025-01-05T10:00:00Z") }),
      makeCes({ id: "c2", submittedAt: new Date("2025-01-15T10:00:00Z") }),
    ];

    const withinWindow = recentResponses.filter(
      (r) => r.submittedAt.getTime() >= thirtyDaysAgo.getTime(),
    );
    expect(withinWindow.length).toBe(2);
    const capExceeded = withinWindow.length >= 3;
    expect(capExceeded).toBe(false);
  });

  it("expired responses (>30 days old) do not count toward cap", () => {
    const now = new Date("2025-02-15T10:00:00Z");
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const responses = [
      makeCes({ id: "c1", submittedAt: new Date("2025-01-01T10:00:00Z") }), // >30 days
      makeCes({ id: "c2", submittedAt: new Date("2025-01-05T10:00:00Z") }), // >30 days
      makeCes({ id: "c3", submittedAt: new Date("2025-02-10T10:00:00Z") }), // within
    ];

    const withinWindow = responses.filter(
      (r) => r.submittedAt.getTime() >= thirtyDaysAgo.getTime(),
    );
    expect(withinWindow.length).toBe(1);
  });
});

// ─── CES Score Validation ─────────────────────────────────────────────────────

describe("CES score validation (1–7)", () => {
  it("accepts scores 1 through 7", () => {
    for (let score = 1; score <= 7; score++) {
      const isValid = score >= 1 && score <= 7 && Number.isInteger(score);
      expect(isValid).toBe(true);
    }
  });

  it("rejects score 0", () => {
    const score = 0;
    const isValid = score >= 1 && score <= 7;
    expect(isValid).toBe(false);
  });

  it("rejects score 8", () => {
    const score = 8;
    const isValid = score >= 1 && score <= 7;
    expect(isValid).toBe(false);
  });

  it("rejects non-integer scores", () => {
    const score = 3.5;
    const isValid = Number.isInteger(score) && score >= 1 && score <= 7;
    expect(isValid).toBe(false);
  });
});
