/** AC-005 — pure overdue/ageing maths for task escalation. */
import { describe, it, expect } from "vitest";
import { evaluateTask, findOverdueTasks } from "../src/modules/activities/task-escalation-domain.js";
import type { TaskEscalationRuleLike, OverdueTaskLike } from "../src/modules/activities/task-escalation-domain.js";

const NOW = new Date("2026-08-04T12:00:00Z");
function minsAgo(m: number): string { return new Date(NOW.getTime() - m * 60_000).toISOString(); }

function rule(o: Partial<TaskEscalationRuleLike> & Pick<TaskEscalationRuleLike, "id" | "thresholdMinutes">): TaskEscalationRuleLike {
  return { appliesTo: "both", enabled: true, recipientRole: "manager", recipientId: null, ...o };
}
function task(o: Partial<OverdueTaskLike> & Pick<OverdueTaskLike, "taskId" | "kind" | "dueAt">): OverdueTaskLike {
  return { subjectType: "contact", subjectId: "s1", ownerId: "o1", ...o };
}

describe("evaluateTask", () => {
  const r = rule({ id: "r1", thresholdMinutes: 60 });

  it("flags an overdue next-action past the threshold with ageing details", () => {
    const hit = evaluateTask(task({ taskId: "t1", kind: "next_action", dueAt: minsAgo(90) }), r, NOW);
    expect(hit).not.toBeNull();
    expect(hit!.ageingMinutes).toBe(90);
    expect(hit!.overdueMinutes).toBe(30);
    expect(hit!.recipientRole).toBe("manager");
    expect(hit!.kind).toBe("next_action");
  });

  it("does not flag before the threshold is reached", () => {
    expect(evaluateTask(task({ taskId: "t1", kind: "task", dueAt: minsAgo(30) }), r, NOW)).toBeNull();
  });

  it("does not flag a task with no due date", () => {
    expect(evaluateTask(task({ taskId: "t1", kind: "task", dueAt: null }), r, NOW)).toBeNull();
  });

  it("respects appliesTo scope", () => {
    const naOnly = rule({ id: "r2", thresholdMinutes: 60, appliesTo: "next_action" });
    expect(evaluateTask(task({ taskId: "t2", kind: "task", dueAt: minsAgo(120) }), naOnly, NOW)).toBeNull();
    expect(evaluateTask(task({ taskId: "t3", kind: "next_action", dueAt: minsAgo(120) }), naOnly, NOW)).not.toBeNull();
  });

  it("ignores disabled rules and non-positive thresholds", () => {
    expect(evaluateTask(task({ taskId: "t1", kind: "task", dueAt: minsAgo(999) }), rule({ id: "r", thresholdMinutes: 60, enabled: false }), NOW)).toBeNull();
    expect(evaluateTask(task({ taskId: "t1", kind: "task", dueAt: minsAgo(999) }), rule({ id: "r", thresholdMinutes: 0 }), NOW)).toBeNull();
  });
});

describe("findOverdueTasks", () => {
  it("returns the first matching rule per task and skips uncovered tasks", () => {
    const tasks = [
      task({ taskId: "a", kind: "next_action", dueAt: minsAgo(200) }),
      task({ taskId: "b", kind: "task", dueAt: minsAgo(10) }), // not overdue
    ];
    const rules = [rule({ id: "tight", thresholdMinutes: 30 }), rule({ id: "loose", thresholdMinutes: 120 })];
    const out = findOverdueTasks(tasks, rules, NOW);
    expect(out.length).toBe(1);
    expect(out[0].taskId).toBe("a");
    expect(out[0].ruleId).toBe("tight");
  });
});
