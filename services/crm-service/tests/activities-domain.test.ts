/**
 * CRM Activities — recurrence, next-action, task-escalation domain tests.
 * Pack #02. Source: modules/activities/recurrence-domain.ts, next-action-domain.ts, task-escalation-domain.ts
 */
import { describe, it, expect } from "vitest";
import { nextOccurrence, shouldEscalate, isCadence, CADENCES } from "../src/modules/activities/recurrence-domain.js";
import { requiresNextAction, isOverdue } from "../src/modules/activities/next-action-domain.js";
import { evaluateTask, findOverdueTasks } from "../src/modules/activities/task-escalation-domain.js";

// ─── Recurrence ──────────────────────────────────────────────────────────────

describe("nextOccurrence — recurrence expansion", () => {
  it("daily: adds 24h", () => {
    const next = nextOccurrence("daily", new Date("2026-07-15T10:00:00Z"));
    expect(next.toISOString()).toBe("2026-07-16T10:00:00.000Z");
  });

  it("weekly: adds 7 days", () => {
    const next = nextOccurrence("weekly", new Date("2026-07-15T10:00:00Z"));
    expect(next.toISOString()).toBe("2026-07-22T10:00:00.000Z");
  });

  it("monthly: Jan 31 → Feb 28 (clamped)", () => {
    const next = nextOccurrence("monthly", new Date("2026-01-31T00:00:00Z"));
    expect(next.getUTCMonth()).toBe(1); // Feb
    expect(next.getUTCDate()).toBe(28);
  });

  it("quarterly: adds 3 months", () => {
    const next = nextOccurrence("quarterly", new Date("2026-04-01T00:00:00Z"));
    expect(next.getUTCMonth()).toBe(6); // July
    expect(next.getUTCDate()).toBe(1);
  });

  it("throws RangeError for invalid date", () => {
    expect(() => nextOccurrence("daily", "not-a-date")).toThrow(RangeError);
  });
});

describe("isCadence — type guard", () => {
  it.each(["daily", "weekly", "monthly", "quarterly"] as const)("accepts: %s", (c) => expect(isCadence(c)).toBe(true));
  it("rejects invalid", () => expect(isCadence("yearly")).toBe(false));
});

describe("shouldEscalate — overdue task escalation", () => {
  it("returns true when past escalation window", () => {
    const due = new Date("2026-07-15T10:00:00Z");
    const now = new Date("2026-07-15T14:00:00Z"); // 4h later
    expect(shouldEscalate(due, 2, now)).toBe(true); // 2h window exceeded
  });

  it("returns false when within window", () => {
    const due = new Date("2026-07-15T10:00:00Z");
    const now = new Date("2026-07-15T11:00:00Z"); // 1h later
    expect(shouldEscalate(due, 2, now)).toBe(false);
  });

  it("returns false for null escalation hours", () => {
    expect(shouldEscalate(new Date(), null, new Date())).toBe(false);
  });

  it("returns false for non-positive hours", () => {
    expect(shouldEscalate(new Date("2020-01-01"), 0, new Date())).toBe(false);
    expect(shouldEscalate(new Date("2020-01-01"), -1, new Date())).toBe(false);
  });
});

// ─── Next Action ─────────────────────────────────────────────────────────────

describe("requiresNextAction", () => {
  it("active leads require next action", () => {
    expect(requiresNextAction("new")).toBe(true);
    expect(requiresNextAction("qualified")).toBe(true);
    expect(requiresNextAction("nurture")).toBe(true);
  });

  it("closed/converted do NOT require", () => {
    expect(requiresNextAction("won")).toBe(false);
    expect(requiresNextAction("lost")).toBe(false);
    expect(requiresNextAction("converted")).toBe(false);
    expect(requiresNextAction("disqualified")).toBe(false);
    expect(requiresNextAction("inactive")).toBe(false);
  });

  it("null/empty returns false", () => {
    expect(requiresNextAction(null)).toBe(false);
    expect(requiresNextAction("")).toBe(false);
  });

  it("case-insensitive", () => {
    expect(requiresNextAction("Won")).toBe(false);
    expect(requiresNextAction("NEW")).toBe(true);
  });
});

describe("isOverdue", () => {
  it("returns true when due date is past", () => {
    expect(isOverdue("2026-07-01T00:00:00Z", new Date("2026-07-15T00:00:00Z"))).toBe(true);
  });

  it("returns false when due date is future", () => {
    expect(isOverdue("2026-08-01T00:00:00Z", new Date("2026-07-15T00:00:00Z"))).toBe(false);
  });
});

// ─── Task Escalation ─────────────────────────────────────────────────────────

describe("evaluateTask — task overdue detection", () => {
  const rule = { id: "r1", appliesTo: "both" as const, thresholdMinutes: 60, enabled: true, recipientRole: "manager", recipientId: null };
  const now = new Date("2026-07-15T12:00:00Z");

  it("returns null when not yet overdue", () => {
    const task = { taskId: "t1", kind: "task" as const, subjectType: "deal", subjectId: "d1", dueAt: "2026-07-15T11:30:00Z" };
    expect(evaluateTask(task, rule, now)).toBeNull(); // only 30min past due, threshold is 60
  });

  it("returns escalated task when overdue past threshold", () => {
    const task = { taskId: "t1", kind: "task" as const, subjectType: "deal", subjectId: "d1", dueAt: "2026-07-15T10:00:00Z" };
    const result = evaluateTask(task, rule, now);
    expect(result).not.toBeNull();
    expect(result!.ageingMinutes).toBe(120);
    expect(result!.overdueMinutes).toBe(60); // 120 - 60 threshold
    expect(result!.recipientRole).toBe("manager");
  });

  it("returns null for disabled rule", () => {
    const disabledRule = { ...rule, enabled: false };
    const task = { taskId: "t1", kind: "task" as const, subjectType: null, subjectId: null, dueAt: "2026-07-15T08:00:00Z" };
    expect(evaluateTask(task, disabledRule, now)).toBeNull();
  });

  it("returns null when rule does not cover task kind", () => {
    const nextActionOnly = { ...rule, appliesTo: "next_action" as const };
    const task = { taskId: "t1", kind: "task" as const, subjectType: null, subjectId: null, dueAt: "2026-07-15T08:00:00Z" };
    expect(evaluateTask(task, nextActionOnly, now)).toBeNull();
  });
});

describe("findOverdueTasks — first matching rule wins", () => {
  it("returns first matching rule per task", () => {
    const rules = [
      { id: "tight", appliesTo: "both" as const, thresholdMinutes: 30, enabled: true, recipientRole: "supervisor", recipientId: null },
      { id: "loose", appliesTo: "both" as const, thresholdMinutes: 120, enabled: true, recipientRole: "manager", recipientId: null },
    ];
    const tasks = [{ taskId: "t1", kind: "task" as const, subjectType: null, subjectId: null, dueAt: "2026-07-15T10:00:00Z" }];
    const now = new Date("2026-07-15T12:00:00Z");
    const results = findOverdueTasks(tasks, rules, now);
    expect(results.length).toBe(1);
    expect(results[0]!.ruleId).toBe("tight"); // tighter threshold matched first
  });
});
