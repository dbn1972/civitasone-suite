/**
 * Scheduled worker — statutory meeting-frequency check: unit tests.
 *
 * Focus is the PURE overdue-detection logic (`nextStatutoryDueDate`, `daysBetween`,
 * `evaluateStatutoryDue`, `detectOverdueCommittees`, `buildStatutoryOverdueMessages`) which
 * owns the correctness of the check (Req 2.5) — deterministic, `today`-injected, no I/O. The
 * orchestration (`runStatutoryFrequencyCheck`) is exercised with injected fake dependencies to
 * verify per-committee emission, secretary wiring, result accounting, and failure isolation
 * (no live database, per the CQRS/outbox seams the worker exposes).
 *
 * _Requirements: 2.5, 16.2_
 */
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import {
  toIsoDate,
  nextStatutoryDueDate,
  daysBetween,
  evaluateStatutoryDue,
  detectOverdueCommittees,
  buildStatutoryOverdueMessages,
  runStatutoryFrequencyCheck,
  startStatutoryFrequencyScheduler,
  SYSTEM_ACTOR_ID,
  HELD_STATUSES,
  type StatutoryCommitteeCandidate,
  type OverdueCommittee,
  type OutboxMessageInput,
} from "../src/workers/statutory-frequency-check.js";
import { EVENTS, SERVICE } from "../src/topics.js";
import { NOTIFICATION_SEND } from "@civitasone/events";

/** Silent logger so the sweep does not spam test output. */
const silentLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
} as unknown as Logger;

const AUDIT_TOPIC = "audit.event.record";
const C1 = "11111111-1111-1111-1111-111111111111";
const C2 = "22222222-2222-2222-2222-222222222222";
const T1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const T2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("toIsoDate", () => {
  it("normalises Date and string values to YYYY-MM-DD", () => {
    expect(toIsoDate(new Date("2026-03-15T09:30:00Z"))).toBe("2026-03-15");
    expect(toIsoDate("2026-03-15")).toBe("2026-03-15");
    expect(toIsoDate("2026-03-15T23:59:59Z")).toBe("2026-03-15");
  });

  it("passes through null/undefined and rejects invalid dates", () => {
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
    expect(toIsoDate("not-a-date")).toBeNull();
  });
});

describe("nextStatutoryDueDate (UTC calendar arithmetic)", () => {
  it("advances by the correct period per frequency", () => {
    expect(nextStatutoryDueDate("2026-01-01", "weekly")).toBe("2026-01-08");
    expect(nextStatutoryDueDate("2026-01-01", "fortnightly")).toBe("2026-01-15");
    expect(nextStatutoryDueDate("2026-01-01", "monthly")).toBe("2026-02-01");
    expect(nextStatutoryDueDate("2026-01-01", "quarterly")).toBe("2026-04-01");
    expect(nextStatutoryDueDate("2026-01-01", "half_yearly")).toBe("2026-07-01");
    expect(nextStatutoryDueDate("2026-01-01", "annual")).toBe("2027-01-01");
  });

  it("handles month/quarter end-of-month roll-over deterministically", () => {
    // Jan 31 + 1 month lands on Mar 3 (UTC), matching setUTCMonth semantics.
    expect(nextStatutoryDueDate("2026-01-31", "monthly")).toBe("2026-03-03");
    expect(nextStatutoryDueDate("2026-11-30", "quarterly")).toBe("2027-03-02");
  });

  it("returns null for ad_hoc / unknown frequencies (no fixed obligation)", () => {
    expect(nextStatutoryDueDate("2026-01-01", "ad_hoc")).toBeNull();
    expect(nextStatutoryDueDate("2026-01-01", "biannual")).toBeNull();
    expect(nextStatutoryDueDate("2026-01-01", "")).toBeNull();
  });

  it("returns null for an unparseable anchor date", () => {
    expect(nextStatutoryDueDate("garbage", "monthly")).toBeNull();
  });
});

describe("daysBetween", () => {
  it("computes whole UTC days (later - earlier)", () => {
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(0);
    expect(daysBetween("2026-01-01", "2026-01-11")).toBe(10);
    expect(daysBetween("2026-01-11", "2026-01-01")).toBe(-10);
  });
});

describe("evaluateStatutoryDue (Req 2.5)", () => {
  it("flags overdue when the derived due date is strictly before today", () => {
    // Finance Committee, quarterly per GFR Rule 89 — last met 2026-01-01, checked mid-May.
    const e = evaluateStatutoryDue({ frequency: "quarterly", anchorDate: "2026-01-01", today: "2026-05-15" });
    expect(e.nextDueDate).toBe("2026-04-01");
    expect(e.overdue).toBe(true);
    expect(e.daysOverdue).toBe(daysBetween("2026-04-01", "2026-05-15"));
  });

  it("is not overdue before the due date", () => {
    const e = evaluateStatutoryDue({ frequency: "quarterly", anchorDate: "2026-01-01", today: "2026-03-15" });
    expect(e.nextDueDate).toBe("2026-04-01");
    expect(e.overdue).toBe(false);
    expect(e.daysOverdue).toBe(0);
  });

  it("treats the due date itself as not-yet-overdue (boundary: nextDue == today)", () => {
    const e = evaluateStatutoryDue({ frequency: "monthly", anchorDate: "2026-01-01", today: "2026-02-01" });
    expect(e.nextDueDate).toBe("2026-02-01");
    expect(e.overdue).toBe(false);
    expect(e.daysOverdue).toBe(0);
  });

  it("carries no obligation for ad_hoc / unknown frequency", () => {
    const e = evaluateStatutoryDue({ frequency: "ad_hoc", anchorDate: "2020-01-01", today: "2026-05-15" });
    expect(e).toEqual({ nextDueDate: null, overdue: false, daysOverdue: 0 });
  });
});

describe("detectOverdueCommittees (Req 2.5)", () => {
  const today = "2026-05-15";

  const overdueQuarterly: StatutoryCommitteeCandidate = {
    committeeId: C1,
    tenantId: T1,
    meetingFrequency: "quarterly",
    statutoryBasis: "GFR Rule 89",
    lastMeetingDate: "2026-01-01",
    constitutionDate: "2025-01-01",
  };
  const currentMonthly: StatutoryCommitteeCandidate = {
    committeeId: C2,
    tenantId: T2,
    meetingFrequency: "monthly",
    statutoryBasis: null,
    lastMeetingDate: "2026-05-01",
    constitutionDate: "2024-01-01",
  };

  it("returns only the overdue committees with computed obligation context", () => {
    const overdue = detectOverdueCommittees([overdueQuarterly, currentMonthly], today);
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({
      committeeId: C1,
      tenantId: T1,
      statutoryBasis: "GFR Rule 89",
      expectedBy: "2026-04-01",
      anchorDate: "2026-01-01",
      lastMeetingDate: "2026-01-01",
    });
    expect(overdue[0]!.daysOverdue).toBeGreaterThan(0);
  });

  it("anchors to the constitution date when the committee has never met", () => {
    const neverMet: StatutoryCommitteeCandidate = {
      committeeId: C2,
      tenantId: T2,
      meetingFrequency: "annual",
      statutoryBasis: "Companies Act AGM",
      lastMeetingDate: null,
      constitutionDate: "2024-01-01",
    };
    const overdue = detectOverdueCommittees([neverMet], today);
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({
      committeeId: C2,
      anchorDate: "2024-01-01",
      lastMeetingDate: null,
      expectedBy: "2025-01-01",
    });
  });

  it("excludes committees with no obligation (ad_hoc) and those not yet due", () => {
    const adHoc: StatutoryCommitteeCandidate = {
      committeeId: C1,
      tenantId: T1,
      meetingFrequency: "ad_hoc",
      statutoryBasis: null,
      lastMeetingDate: "2020-01-01",
      constitutionDate: "2019-01-01",
    };
    expect(detectOverdueCommittees([adHoc, currentMonthly], today)).toEqual([]);
  });

  it("returns empty for no candidates", () => {
    expect(detectOverdueCommittees([], today)).toEqual([]);
  });
});

describe("buildStatutoryOverdueMessages (Req 2.5, 16.2)", () => {
  const overdue: OverdueCommittee = {
    committeeId: C1,
    tenantId: T1,
    statutoryBasis: "GFR Rule 89",
    expectedBy: "2026-04-01",
    anchorDate: "2026-01-01",
    lastMeetingDate: "2026-01-01",
    daysOverdue: 44,
  };
  const meta = { actorId: SYSTEM_ACTOR_ID, correlationId: "statutory-check-x" };

  it("emits the canonical compliance event + a notification per secretary + an audit fact", () => {
    const messages = buildStatutoryOverdueMessages(overdue, ["sec-1", "sec-2"], meta);
    expect(messages).toHaveLength(4); // event + 2 notifications + audit

    const event = messages.find((m) => m.topic === EVENTS.statutoryMeetingOverdue)!;
    expect(event.payload).toMatchObject({
      committeeId: C1,
      expectedBy: "2026-04-01",
      statutoryBasis: "GFR Rule 89",
      lastMeetingDate: "2026-01-01",
      daysOverdue: 44,
    });
    expect(event.tenantId).toBe(T1);
    expect(event.actorId).toBe(SYSTEM_ACTOR_ID);

    const notifications = messages.filter((m) => m.topic === NOTIFICATION_SEND);
    expect(notifications).toHaveLength(2);
    expect(notifications.map((n) => n.payload.recipient)).toEqual(["sec-1", "sec-2"]);
    for (const n of notifications) {
      expect(n.payload.channel).toBe("email");
      expect(n.payload.eventType).toBe(EVENTS.statutoryMeetingOverdue);
      // Non-PII variables only.
      expect(n.payload.variables).toMatchObject({ committeeId: C1, expectedBy: "2026-04-01", daysOverdue: "44" });
    }

    const audit = messages.find((m) => m.topic === AUDIT_TOPIC)!;
    expect(audit.payload).toMatchObject({
      service: SERVICE,
      action: "statutory_meeting_overdue",
      resourceType: "committee",
      resourceId: C1,
      outcome: "success",
    });
  });

  it("still emits event + audit when the committee has no secretary (no notifications)", () => {
    const messages = buildStatutoryOverdueMessages(overdue, [], meta);
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.topic).sort()).toEqual([AUDIT_TOPIC, EVENTS.statutoryMeetingOverdue].sort());
  });

  it("omits statutoryBasis from notification variables when null", () => {
    const messages = buildStatutoryOverdueMessages({ ...overdue, statutoryBasis: null }, ["sec-1"], meta);
    const notification = messages.find((m) => m.topic === NOTIFICATION_SEND)!;
    expect(notification.payload.variables).not.toHaveProperty("statutoryBasis");
  });
});

describe("HELD_STATUSES", () => {
  it("matches the committee-repo definition of a held meeting", () => {
    expect([...HELD_STATUSES]).toEqual([
      "in_progress",
      "adjourned",
      "minutes_pending",
      "minutes_approved",
      "closed",
      "archived",
    ]);
  });
});

describe("runStatutoryFrequencyCheck orchestration (Req 2.5)", () => {
  const today = new Date("2026-05-15T06:00:00Z");

  const overdueCandidate: StatutoryCommitteeCandidate = {
    committeeId: C1,
    tenantId: T1,
    meetingFrequency: "quarterly",
    statutoryBasis: "GFR Rule 89",
    lastMeetingDate: "2026-01-01",
    constitutionDate: "2025-01-01",
  };
  const currentCandidate: StatutoryCommitteeCandidate = {
    committeeId: C2,
    tenantId: T2,
    meetingFrequency: "monthly",
    statutoryBasis: null,
    lastMeetingDate: "2026-05-01",
    constitutionDate: "2024-01-01",
  };

  it("detects overdue committees and emits one batch each, with secretary recipients wired in", async () => {
    const emitted: Array<{ overdue: OverdueCommittee; messages: OutboxMessageInput[] }> = [];
    const loadSecretaryRecipients = vi.fn().mockResolvedValue(["sec-1"]);

    const result = await runStatutoryFrequencyCheck({
      now: today,
      logger: silentLogger,
      loadCandidates: async () => [overdueCandidate, currentCandidate],
      loadSecretaryRecipients,
      emit: async (overdue, messages) => {
        emitted.push({ overdue, messages });
      },
    });

    expect(result).toEqual({ scanned: 2, overdue: 1, emitted: 1, failed: 0 });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.overdue.committeeId).toBe(C1);
    expect(loadSecretaryRecipients).toHaveBeenCalledTimes(1);

    // The emitted batch carries the compliance event + the resolved secretary notification.
    const topics = emitted[0]!.messages.map((m) => m.topic);
    expect(topics).toContain(EVENTS.statutoryMeetingOverdue);
    expect(topics).toContain(NOTIFICATION_SEND);
  });

  it("isolates a per-committee emit failure without aborting the sweep", async () => {
    const overdueSecond: StatutoryCommitteeCandidate = {
      committeeId: C2,
      tenantId: T2,
      meetingFrequency: "monthly",
      statutoryBasis: null,
      lastMeetingDate: "2026-01-01",
      constitutionDate: "2024-01-01",
    };
    const emit = vi
      .fn()
      .mockRejectedValueOnce(new Error("outbox unavailable")) // first overdue fails
      .mockResolvedValueOnce(undefined); // second overdue succeeds

    const result = await runStatutoryFrequencyCheck({
      now: today,
      logger: silentLogger,
      loadCandidates: async () => [overdueCandidate, overdueSecond],
      loadSecretaryRecipients: async () => [],
      emit,
    });

    expect(result).toEqual({ scanned: 2, overdue: 2, emitted: 1, failed: 1 });
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("returns zero counts when nothing is overdue", async () => {
    const emit = vi.fn();
    const result = await runStatutoryFrequencyCheck({
      now: today,
      logger: silentLogger,
      loadCandidates: async () => [currentCandidate],
      loadSecretaryRecipients: async () => [],
      emit,
    });
    expect(result).toEqual({ scanned: 1, overdue: 0, emitted: 0, failed: 0 });
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("startStatutoryFrequencyScheduler", () => {
  it("returns an unref'd timer and runs a cycle on tick without throwing", async () => {
    vi.useFakeTimers();
    try {
      const loadCandidates = vi.fn().mockResolvedValue([]);
      const handle = startStatutoryFrequencyScheduler(1000, {
        logger: silentLogger,
        loadCandidates,
        loadSecretaryRecipients: async () => [],
        emit: async () => {},
      });
      expect(handle).toBeDefined();

      // Advance to the first tick; the scheduler invokes the runnable.
      await vi.advanceTimersByTimeAsync(1000);
      expect(loadCandidates).toHaveBeenCalled();

      clearInterval(handle);
    } finally {
      vi.useRealTimers();
    }
  });
});
