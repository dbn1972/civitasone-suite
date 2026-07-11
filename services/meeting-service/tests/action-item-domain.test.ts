/**
 * action-item module — unit tests for the pure domain logic (SLA computation, escalation chain,
 * overdue detection, evidence-before-verification, the referential+temporal deadline invariant,
 * and ATR compilation/statistics). All functions are pure and deterministic; the caller injects
 * `now`/instants, so no I/O or clock coupling is exercised here. The dedicated property tests
 * (P19–P22) land in task 11.4 — these examples cover the core branches and edge cases.
 *
 * _Requirements: 9.1, 9.2, 9.5, 9.6, 9.7, 10.1, 10.2, 10.4_
 */
import { describe, expect, it } from "vitest";
import {
  ACTION_ITEM_STATUSES,
  ACTION_PRIORITIES,
  SETTLED_STATUSES,
  isSettledStatus,
  computeSlaHours,
  deriveDeadlineFromSla,
  DEFAULT_ESCALATION_CHAIN,
  maxEscalationLevel,
  escalationTarget,
  computeEscalationLevel,
  nextEscalationAt,
  resolveEscalationState,
  assertEscalationMonotonic,
  isOverdue,
  resolveOverdueStatus,
  hasEvidence,
  assertEvidenceBeforeVerification,
  isDeadlineAfterMeetingStart,
  assertDeadlineAfterMeetingStart,
  classifyAtrItem,
  computeAtrStatistics,
  computeCompliancePerAssignee,
  daysOverdue,
  isAtrIncludable,
  compileAtr,
  ATR_COMPLIANCE_FLOOR_PCT,
  type AtrSourceItem,
} from "../src/modules/action-item/domain.js";
import { HttpError } from "../src/shared/context.js";

const d = (iso: string) => new Date(iso);
const A1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const A2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("domain vocabularies", () => {
  it("exposes the migration status value set", () => {
    expect([...ACTION_ITEM_STATUSES]).toEqual([
      "assigned",
      "acknowledged",
      "in_progress",
      "evidence_submitted",
      "verified",
      "completed",
      "overdue",
      "escalated",
      "withdrawn",
    ]);
    expect([...ACTION_PRIORITIES]).toEqual(["critical", "high", "medium", "low"]);
    expect([...SETTLED_STATUSES]).toEqual(["completed", "verified", "withdrawn"]);
  });

  it("classifies settled statuses", () => {
    expect(isSettledStatus("completed")).toBe(true);
    expect(isSettledStatus("verified")).toBe(true);
    expect(isSettledStatus("withdrawn")).toBe(true);
    expect(isSettledStatus("assigned")).toBe(false);
    expect(isSettledStatus("overdue")).toBe(false);
  });
});

describe("SLA computation (Req 9.1)", () => {
  it("computes the assignment→deadline window in whole hours", () => {
    expect(computeSlaHours(d("2026-01-01T00:00:00Z"), d("2026-01-01T24:00:00Z"))).toBe(24);
    expect(computeSlaHours(d("2026-01-01T00:00:00Z"), d("2026-01-04T00:00:00Z"))).toBe(72);
  });

  it("rounds to the nearest hour", () => {
    expect(computeSlaHours(d("2026-01-01T00:00:00Z"), d("2026-01-01T02:40:00Z"))).toBe(3);
  });

  it("returns 0 for a non-positive window (never negative)", () => {
    expect(computeSlaHours(d("2026-01-02T00:00:00Z"), d("2026-01-01T00:00:00Z"))).toBe(0);
    expect(computeSlaHours(d("2026-01-01T00:00:00Z"), d("2026-01-01T00:00:00Z"))).toBe(0);
  });

  it("deriveDeadlineFromSla is the inverse of computeSlaHours", () => {
    const assignedAt = d("2026-01-01T00:00:00Z");
    const deadline = deriveDeadlineFromSla(assignedAt, 48);
    expect(deadline.toISOString()).toBe("2026-01-03T00:00:00.000Z");
    expect(computeSlaHours(assignedAt, deadline)).toBe(48);
  });

  it("deriveDeadlineFromSla clamps a non-positive SLA to the assignment instant", () => {
    const assignedAt = d("2026-01-01T00:00:00Z");
    expect(deriveDeadlineFromSla(assignedAt, 0).getTime()).toBe(assignedAt.getTime());
    expect(deriveDeadlineFromSla(assignedAt, -5).getTime()).toBe(assignedAt.getTime());
  });
});

describe("escalation logic (Req 9.5, 9.6 · P20)", () => {
  it("defines the default L1/L2/L3 chain per the requirement", () => {
    expect(DEFAULT_ESCALATION_CHAIN.map((r) => [r.level, r.afterDeadlineHours, r.notify])).toEqual([
      [1, 24, "supervisor"],
      [2, 72, "department_head"],
      [3, 168, "chairperson"],
    ]);
    expect(maxEscalationLevel()).toBe(3);
  });

  it("maps a level to its notify target", () => {
    expect(escalationTarget(1)).toBe("supervisor");
    expect(escalationTarget(2)).toBe("department_head");
    expect(escalationTarget(3)).toBe("chairperson");
    expect(escalationTarget(4)).toBeNull();
  });

  it("computes the level from how far past the deadline now is", () => {
    const deadline = d("2026-01-01T00:00:00Z");
    expect(computeEscalationLevel(deadline, d("2026-01-01T12:00:00Z"))).toBe(0);
    expect(computeEscalationLevel(deadline, d("2026-01-02T00:00:00Z"))).toBe(1); // +24h
    expect(computeEscalationLevel(deadline, d("2026-01-04T00:00:00Z"))).toBe(2); // +72h
    expect(computeEscalationLevel(deadline, d("2026-01-08T00:00:00Z"))).toBe(3); // +7d
  });

  it("computes the next escalation instant, or null at the top of the chain", () => {
    const deadline = d("2026-01-01T00:00:00Z");
    expect(nextEscalationAt(deadline, 0)?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
    expect(nextEscalationAt(deadline, 1)?.toISOString()).toBe("2026-01-04T00:00:00.000Z");
    expect(nextEscalationAt(deadline, 2)?.toISOString()).toBe("2026-01-08T00:00:00.000Z");
    expect(nextEscalationAt(deadline, 3)).toBeNull();
  });

  it("resolveEscalationState advances the level and names the new target", () => {
    const state = resolveEscalationState({
      deadline: d("2026-01-01T00:00:00Z"),
      currentLevel: 0,
      now: d("2026-01-04T00:00:00Z"),
    });
    expect(state.level).toBe(2);
    expect(state.escalated).toBe(true);
    expect(state.notify).toBe("department_head");
    expect(state.nextEscalationAt?.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });

  it("resolveEscalationState never regresses below the current level (P20)", () => {
    const state = resolveEscalationState({
      deadline: d("2026-01-01T00:00:00Z"),
      currentLevel: 3,
      now: d("2026-01-01T12:00:00Z"), // computed level would be 0
    });
    expect(state.level).toBe(3);
    expect(state.escalated).toBe(false);
    expect(state.notify).toBeNull();
    expect(state.nextEscalationAt).toBeNull();
  });

  it("assertEscalationMonotonic rejects a decrease (P20)", () => {
    expect(() => assertEscalationMonotonic(2, 1)).toThrow(HttpError);
    expect(() => assertEscalationMonotonic(1, 1)).not.toThrow();
    expect(() => assertEscalationMonotonic(1, 2)).not.toThrow();
  });
});

describe("overdue detection (Req 9.5 · P21)", () => {
  const now = d("2026-01-10T00:00:00Z");

  it("is overdue IFF deadline passed AND not settled", () => {
    expect(isOverdue({ deadline: d("2026-01-09T00:00:00Z"), status: "in_progress", now })).toBe(true);
    expect(isOverdue({ deadline: d("2026-01-11T00:00:00Z"), status: "in_progress", now })).toBe(false);
  });

  it("is never overdue for settled statuses", () => {
    for (const status of SETTLED_STATUSES) {
      expect(isOverdue({ deadline: d("2026-01-01T00:00:00Z"), status, now })).toBe(false);
    }
  });

  it("resolveOverdueStatus moves a lapsed non-settled item to overdue", () => {
    expect(resolveOverdueStatus({ deadline: d("2026-01-09T00:00:00Z"), status: "in_progress", now })).toBe("overdue");
  });

  it("resolveOverdueStatus preserves escalated and settled statuses", () => {
    expect(resolveOverdueStatus({ deadline: d("2026-01-09T00:00:00Z"), status: "escalated", now })).toBe("escalated");
    expect(resolveOverdueStatus({ deadline: d("2026-01-01T00:00:00Z"), status: "completed", now })).toBe("completed");
  });

  it("resolveOverdueStatus leaves a not-yet-due item unchanged", () => {
    expect(resolveOverdueStatus({ deadline: d("2026-01-11T00:00:00Z"), status: "assigned", now })).toBe("assigned");
  });
});

describe("evidence before verification (Req 9.7 · P22)", () => {
  it("detects evidence from url or note", () => {
    expect(hasEvidence({ evidenceUrl: "https://x/e" })).toBe(true);
    expect(hasEvidence({ evidenceNote: "done" })).toBe(true);
    expect(hasEvidence({ evidenceUrl: "   ", evidenceNote: "  " })).toBe(false);
    expect(hasEvidence({})).toBe(false);
  });

  it("assertEvidenceBeforeVerification throws when no evidence present", () => {
    expect(() => assertEvidenceBeforeVerification({})).toThrow(HttpError);
    expect(() => assertEvidenceBeforeVerification({ evidenceNote: "done" })).not.toThrow();
  });
});

describe("referential+temporal deadline invariant (Req 9.1 · P19)", () => {
  it("requires the deadline strictly after the meeting start", () => {
    const start = d("2026-01-01T10:00:00Z");
    expect(isDeadlineAfterMeetingStart(d("2026-01-01T11:00:00Z"), start)).toBe(true);
    expect(isDeadlineAfterMeetingStart(d("2026-01-01T10:00:00Z"), start)).toBe(false);
    expect(isDeadlineAfterMeetingStart(d("2026-01-01T09:00:00Z"), start)).toBe(false);
  });

  it("is vacuously satisfied when the meeting has no recorded start", () => {
    expect(isDeadlineAfterMeetingStart(d("2020-01-01T00:00:00Z"), null)).toBe(true);
    expect(isDeadlineAfterMeetingStart(d("2020-01-01T00:00:00Z"), undefined)).toBe(true);
  });

  it("assertDeadlineAfterMeetingStart throws ACTION_ITEM_DEADLINE_INVALID (422)", () => {
    const start = d("2026-01-01T10:00:00Z");
    try {
      assertDeadlineAfterMeetingStart(d("2026-01-01T09:00:00Z"), start);
      expect.unreachable("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).code).toBe("ACTION_ITEM_DEADLINE_INVALID");
      expect((err as HttpError).status).toBe(422);
    }
    expect(() => assertDeadlineAfterMeetingStart(d("2026-01-01T11:00:00Z"), start)).not.toThrow();
  });
});

describe("ATR classification and statistics (Req 10.1, 10.2, 10.4)", () => {
  const now = d("2026-02-01T00:00:00Z");
  const deadline = d("2026-01-15T00:00:00Z");

  it("classifies each outcome bucket", () => {
    expect(classifyAtrItem({ status: "withdrawn", deadline }, now)).toBe("withdrawn");
    expect(classifyAtrItem({ status: "completed", deadline, completedAt: d("2026-01-14T00:00:00Z") }, now)).toBe(
      "completed_on_time",
    );
    expect(classifyAtrItem({ status: "verified", deadline, completedAt: d("2026-01-20T00:00:00Z") }, now)).toBe(
      "completed_late",
    );
    expect(classifyAtrItem({ status: "in_progress", deadline }, now)).toBe("overdue");
    expect(classifyAtrItem({ status: "in_progress", deadline: d("2026-03-01T00:00:00Z") }, now)).toBe("pending");
  });

  it("treats a completed item with no completedAt as on-time", () => {
    expect(classifyAtrItem({ status: "completed", deadline }, now)).toBe("completed_on_time");
  });

  it("computes summary statistics and compliance percentage", () => {
    const items = [
      { status: "completed", deadline, completedAt: d("2026-01-10T00:00:00Z") }, // on time
      { status: "verified", deadline, completedAt: d("2026-01-20T00:00:00Z") }, // late
      { status: "in_progress", deadline }, // overdue
      { status: "withdrawn", deadline }, // withdrawn
    ];
    const stats = computeAtrStatistics(items, now);
    expect(stats).toMatchObject({
      total: 4,
      completedOnTime: 1,
      completedLate: 1,
      overdue: 1,
      withdrawn: 1,
      pending: 0,
      compliancePct: 25, // 1 on-time / 4 total
    });
  });

  it("reports 0 compliance for an empty set", () => {
    expect(computeAtrStatistics([], now).compliancePct).toBe(0);
  });

  it("computes days overdue (rounded up), 0 when not overdue", () => {
    expect(daysOverdue({ status: "in_progress", deadline: d("2026-01-30T12:00:00Z") }, now)).toBe(2);
    expect(daysOverdue({ status: "completed", deadline }, now)).toBe(0);
  });

  it("groups per-assignee compliance, ordered by id", () => {
    const items = [
      { assigneeId: A2, status: "completed", deadline, completedAt: d("2026-01-10T00:00:00Z") },
      { assigneeId: A1, status: "in_progress", deadline },
    ];
    const per = computeCompliancePerAssignee(items, now);
    expect(per.map((p) => p.assigneeId)).toEqual([A1, A2]);
    expect(per[0]).toMatchObject({ assigneeId: A1, overdue: 1, compliancePct: 0 });
    expect(per[1]).toMatchObject({ assigneeId: A2, completedOnTime: 1, compliancePct: 100 });
  });

  it("isAtrIncludable keeps open items and recently-completed ones", () => {
    expect(isAtrIncludable({ status: "in_progress", deadline }, now)).toBe(true);
    expect(isAtrIncludable({ status: "completed", deadline, completedAt: d("2026-01-25T00:00:00Z") }, now, 90)).toBe(
      true,
    );
    expect(isAtrIncludable({ status: "completed", deadline, completedAt: d("2025-01-01T00:00:00Z") }, now, 90)).toBe(
      false,
    );
  });
});

describe("compileAtr (Req 10.1–10.5)", () => {
  const now = d("2026-02-01T00:00:00Z");
  const deadline = d("2026-01-15T00:00:00Z");

  const items: AtrSourceItem[] = [
    {
      id: "22222222-0000-0000-0000-000000000002",
      assigneeId: A1,
      description: "second by deadline",
      status: "in_progress",
      deadline: d("2026-01-20T00:00:00Z"),
    },
    {
      id: "11111111-0000-0000-0000-000000000001",
      assigneeId: A2,
      description: "first by deadline",
      status: "completed",
      deadline,
      completedAt: d("2026-01-12T00:00:00Z"),
      evidenceNote: "signed off",
    },
  ];

  it("produces stable, deadline-ordered entries with evidence summary and days overdue", () => {
    const atr = compileAtr(items, now);
    expect(atr.entries.map((e) => e.originalDeadline)).toEqual([
      "2026-01-15T00:00:00.000Z",
      "2026-01-20T00:00:00.000Z",
    ]);
    expect(atr.entries[0]).toMatchObject({
      description: "first by deadline",
      outcome: "completed_on_time",
      evidenceSummary: "signed off",
      daysOverdue: 0,
    });
    expect(atr.entries[1]).toMatchObject({ outcome: "overdue", daysOverdue: 12 });
  });

  it("flags below-floor compliance (Req 10.5)", () => {
    const atr = compileAtr(items, now);
    // 1 on-time / 2 total = 50% < 70% floor
    expect(atr.statistics.compliancePct).toBeLessThan(ATR_COMPLIANCE_FLOOR_PCT);
    expect(atr.belowComplianceFloor).toBe(true);
    expect(atr.perAssignee).toHaveLength(2);
  });

  it("does not flag an empty ATR as below floor", () => {
    const atr = compileAtr([], now);
    expect(atr.belowComplianceFloor).toBe(false);
    expect(atr.entries).toEqual([]);
  });
});
