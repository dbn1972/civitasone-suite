/**
 * Meeting Service — Action Item Domain: Deep tests.
 * Source: modules/action-item/domain.ts
 */
import { describe, it, expect } from "vitest";
import {
  computeSlaHours, deriveDeadlineFromSla, computeEscalationLevel, resolveEscalationState,
  isOverdue, resolveOverdueStatus, hasEvidence, classifyAtrItem, computeAtrStatistics,
  isSettledStatus, DEFAULT_ESCALATION_CHAIN, ATR_COMPLIANCE_FLOOR_PCT, assertEscalationMonotonic,
  assertDeadlineAfterMeetingStart, daysOverdue,
} from "../src/modules/action-item/domain.js";

describe("computeSlaHours", () => {
  it("8 hours between 9am and 5pm", () => expect(computeSlaHours(new Date("2026-07-01T09:00:00Z"), new Date("2026-07-01T17:00:00Z"))).toBe(8));
  it("0 when deadline is before assignment", () => expect(computeSlaHours(new Date("2026-07-02"), new Date("2026-07-01"))).toBe(0));
});

describe("deriveDeadlineFromSla", () => {
  it("adds slaHours to assignment time", () => {
    const d = deriveDeadlineFromSla(new Date("2026-07-01T10:00:00Z"), 48);
    expect(d.toISOString()).toBe("2026-07-03T10:00:00.000Z");
  });
});

describe("DEFAULT_ESCALATION_CHAIN", () => {
  it("has 3 rungs", () => expect(DEFAULT_ESCALATION_CHAIN).toHaveLength(3));
  it("L1=24h→supervisor, L2=72h→dept_head, L3=168h→chairperson", () => {
    expect(DEFAULT_ESCALATION_CHAIN[0]).toMatchObject({ level: 1, afterDeadlineHours: 24, notify: "supervisor" });
    expect(DEFAULT_ESCALATION_CHAIN[1]).toMatchObject({ level: 2, afterDeadlineHours: 72, notify: "department_head" });
    expect(DEFAULT_ESCALATION_CHAIN[2]).toMatchObject({ level: 3, afterDeadlineHours: 168, notify: "chairperson" });
  });
});

describe("computeEscalationLevel", () => {
  const deadline = new Date("2026-07-01T00:00:00Z");
  it("0 when before deadline", () => expect(computeEscalationLevel(deadline, new Date("2026-06-30T00:00:00Z"))).toBe(0));
  it("0 when at deadline (not yet 24h past)", () => expect(computeEscalationLevel(deadline, deadline)).toBe(0));
  it("1 at deadline + 24h", () => expect(computeEscalationLevel(deadline, new Date("2026-07-02T00:00:00Z"))).toBe(1));
  it("2 at deadline + 72h", () => expect(computeEscalationLevel(deadline, new Date("2026-07-04T00:00:00Z"))).toBe(2));
  it("3 at deadline + 7d", () => expect(computeEscalationLevel(deadline, new Date("2026-07-08T00:00:00Z"))).toBe(3));
});

describe("resolveEscalationState", () => {
  const deadline = new Date("2026-07-01T00:00:00Z");
  it("escalation is monotonic (never regress)", () => {
    const state = resolveEscalationState({ deadline, currentLevel: 2, now: new Date("2026-07-02T00:00:00Z") });
    expect(state.level).toBe(2); // computed=1 but current=2 → max(2,1)=2
    expect(state.escalated).toBe(false);
  });
  it("escalated=true when level advances", () => {
    const state = resolveEscalationState({ deadline, currentLevel: 0, now: new Date("2026-07-02T00:00:00Z") });
    expect(state.level).toBe(1);
    expect(state.escalated).toBe(true);
    expect(state.notify).toBe("supervisor");
  });
});

describe("assertEscalationMonotonic", () => {
  it("passes when toLevel >= fromLevel", () => expect(() => assertEscalationMonotonic(1, 2)).not.toThrow());
  it("throws when toLevel < fromLevel", () => expect(() => assertEscalationMonotonic(2, 1)).toThrow());
});

describe("isOverdue", () => {
  it("true when past deadline and not settled", () => expect(isOverdue({ deadline: new Date("2026-06-01"), status: "assigned", now: new Date("2026-07-01") })).toBe(true));
  it("false when settled (completed)", () => expect(isOverdue({ deadline: new Date("2020-01-01"), status: "completed", now: new Date("2026-07-01") })).toBe(false));
  it("false when before deadline", () => expect(isOverdue({ deadline: new Date("2027-01-01"), status: "assigned", now: new Date("2026-07-01") })).toBe(false));
});

describe("resolveOverdueStatus", () => {
  it("returns overdue for non-settled past-deadline", () => expect(resolveOverdueStatus({ deadline: new Date("2026-06-01"), status: "assigned", now: new Date("2026-07-01") })).toBe("overdue"));
  it("preserves escalated status", () => expect(resolveOverdueStatus({ deadline: new Date("2026-06-01"), status: "escalated", now: new Date("2026-07-01") })).toBe("escalated"));
  it("returns current status when not overdue", () => expect(resolveOverdueStatus({ deadline: new Date("2027-01-01"), status: "in_progress", now: new Date("2026-07-01") })).toBe("in_progress"));
});

describe("hasEvidence", () => {
  it("true with URL", () => expect(hasEvidence({ evidenceUrl: "https://doc.example.com/report.pdf" })).toBe(true));
  it("true with note", () => expect(hasEvidence({ evidenceNote: "Work completed as per directive" })).toBe(true));
  it("false with neither", () => expect(hasEvidence({})).toBe(false));
  it("false with empty strings", () => expect(hasEvidence({ evidenceUrl: "", evidenceNote: "  " })).toBe(false));
});

describe("classifyAtrItem", () => {
  const now = new Date("2026-07-15");
  it("withdrawn", () => expect(classifyAtrItem({ status: "withdrawn", deadline: new Date("2026-07-01") }, now)).toBe("withdrawn"));
  it("completed_on_time", () => expect(classifyAtrItem({ status: "completed", deadline: new Date("2026-07-20"), completedAt: new Date("2026-07-10") }, now)).toBe("completed_on_time"));
  it("completed_late", () => expect(classifyAtrItem({ status: "completed", deadline: new Date("2026-07-01"), completedAt: new Date("2026-07-10") }, now)).toBe("completed_late"));
  it("overdue", () => expect(classifyAtrItem({ status: "assigned", deadline: new Date("2026-07-01") }, now)).toBe("overdue"));
  it("pending", () => expect(classifyAtrItem({ status: "in_progress", deadline: new Date("2026-08-01") }, now)).toBe("pending"));
});

describe("computeAtrStatistics", () => {
  const now = new Date("2026-07-15");
  const items = [
    { status: "completed", deadline: new Date("2026-07-10"), completedAt: new Date("2026-07-05") },
    { status: "completed", deadline: new Date("2026-07-01"), completedAt: new Date("2026-07-10") },
    { status: "assigned", deadline: new Date("2026-07-01") },
    { status: "withdrawn", deadline: new Date("2026-07-10") },
  ];
  it("counts correctly", () => {
    const s = computeAtrStatistics(items, now);
    expect(s.total).toBe(4);
    expect(s.completedOnTime).toBe(1);
    expect(s.completedLate).toBe(1);
    expect(s.overdue).toBe(1);
    expect(s.withdrawn).toBe(1);
    expect(s.compliancePct).toBe(25); // 1/4
  });
  it("empty set = 0%", () => expect(computeAtrStatistics([], now).compliancePct).toBe(0));
});

describe("daysOverdue", () => {
  it("0 when not overdue", () => expect(daysOverdue({ status: "completed", deadline: new Date("2020-01-01") }, new Date("2026-07-01"))).toBe(0));
  it("positive when past deadline", () => expect(daysOverdue({ status: "assigned", deadline: new Date("2026-07-01") }, new Date("2026-07-04"))).toBe(3));
});

describe("isSettledStatus", () => {
  it("completed is settled", () => expect(isSettledStatus("completed")).toBe(true));
  it("verified is settled", () => expect(isSettledStatus("verified")).toBe(true));
  it("withdrawn is settled", () => expect(isSettledStatus("withdrawn")).toBe(true));
  it("assigned is NOT settled", () => expect(isSettledStatus("assigned")).toBe(false));
});

describe("ATR_COMPLIANCE_FLOOR_PCT", () => {
  it("is 70", () => expect(ATR_COMPLIANCE_FLOOR_PCT).toBe(70));
});
