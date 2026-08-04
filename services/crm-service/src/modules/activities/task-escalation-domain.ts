/**
 * AC-005 — pure overdue/ageing maths for task escalation.
 *
 * Kept free of I/O so "which open tasks are overdue past the manager-escalation
 * threshold, and by how long" can be unit-tested exhaustively, and so the worker
 * scheduler and any future manual "escalate now" path share the same arithmetic.
 *
 * A "task" here is either a mandatory next-action (crm.next_actions) or a
 * task-type activity (crm.activities.type = 'task'). A rule watches one or both
 * via `appliesTo`.
 */

export type TaskKind = "next_action" | "task";

export interface TaskEscalationRuleLike {
  id: string;
  appliesTo: "next_action" | "task" | "both";
  thresholdMinutes: number;
  enabled: boolean;
  recipientRole?: string | null;
  recipientId?: string | null;
}

/** The task facts the overdue check needs; deliberately narrower than the row. */
export interface OverdueTaskLike {
  taskId: string;
  kind: TaskKind;
  subjectType: string | null;
  subjectId: string | null;
  ownerId: string | null;
  dueAt: Date | string | null;
}

export interface EscalatedTask {
  taskId: string;
  kind: TaskKind;
  subjectType: string | null;
  subjectId: string | null;
  ownerId: string | null;
  ruleId: string;
  /** Minutes overdue beyond the configured threshold. */
  overdueMinutes: number;
  /** Total minutes since the task's due time. */
  ageingMinutes: number;
  recipientRole: string | null;
  recipientId: string | null;
}

const MIN_MS = 60_000;

function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ruleCoversKind(rule: TaskEscalationRuleLike, kind: TaskKind): boolean {
  return rule.appliesTo === "both" || rule.appliesTo === kind;
}

/** Evaluate one task against one rule; null when not (yet) overdue or not covered. */
export function evaluateTask(
  task: OverdueTaskLike,
  rule: TaskEscalationRuleLike,
  now: Date,
): EscalatedTask | null {
  if (!rule.enabled) return null;
  if (!ruleCoversKind(rule, task.kind)) return null;
  if (!Number.isFinite(rule.thresholdMinutes) || rule.thresholdMinutes <= 0) return null;

  const due = toDate(task.dueAt);
  if (!due) return null;

  const ageingMinutes = Math.floor((now.getTime() - due.getTime()) / MIN_MS);
  if (ageingMinutes < rule.thresholdMinutes) return null;

  return {
    taskId: task.taskId,
    kind: task.kind,
    subjectType: task.subjectType,
    subjectId: task.subjectId,
    ownerId: task.ownerId,
    ruleId: rule.id,
    ageingMinutes,
    overdueMinutes: ageingMinutes - rule.thresholdMinutes,
    recipientRole: rule.recipientRole ?? null,
    recipientId: rule.recipientId ?? null,
  };
}

/**
 * All overdue tasks across the supplied rules. First matching rule per task wins
 * (order tightest threshold first to tier escalation). A task never covered by any
 * enabled rule yields nothing.
 */
export function findOverdueTasks(
  tasks: OverdueTaskLike[],
  rules: TaskEscalationRuleLike[],
  now: Date,
): EscalatedTask[] {
  const out: EscalatedTask[] = [];
  for (const task of tasks) {
    for (const rule of rules) {
      const hit = evaluateTask(task, rule, now);
      if (hit) {
        out.push(hit);
        break;
      }
    }
  }
  return out;
}
