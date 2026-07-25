import { and, eq, desc, isNull, isNotNull, lte, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { workingCalendars, taskSlaPauses, type WorkingCalendarRow, type TaskSlaPauseRow } from "./schema.js";
import { tasks } from "../tasks/schema.js";
import type { WorkingCalendar } from "../../shared/calendar.js";

export function toCalendar(r: WorkingCalendarRow): WorkingCalendar {
  return {
    timezone: r.timezone,
    workweek: r.workweek,
    holidays: r.holidays,
    workStartMinute: r.workStartMinute,
    workEndMinute: r.workEndMinute,
  };
}

export interface CreateCalendarInput {
  tenantId: string;
  code: string;
  name: string;
  timezone: string;
  workweek: number[];
  holidays: string[];
  workStartMinute: number;
  workEndMinute: number;
  createdBy: string;
}

export async function createCalendar(input: CreateCalendarInput): Promise<WorkingCalendarRow> {
  const rows = await db.transaction((tx) =>
    tx.insert(workingCalendars).values({
      tenantId: input.tenantId,
      code: input.code,
      name: input.name,
      timezone: input.timezone,
      workweek: input.workweek,
      holidays: input.holidays,
      workStartMinute: input.workStartMinute,
      workEndMinute: input.workEndMinute,
      createdBy: input.createdBy,
    }).returning(),
  );
  return rows[0]!;
}

export async function listCalendars(tenantId: string): Promise<WorkingCalendarRow[]> {
  return scopedRead((tx) => tx.select().from(workingCalendars)
    .where(eq(workingCalendars.tenantId, tenantId))
    .orderBy(desc(workingCalendars.createdAt)));
}

export async function findCalendarByCode(tenantId: string, code: string): Promise<WorkingCalendarRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(workingCalendars)
    .where(and(eq(workingCalendars.tenantId, tenantId), eq(workingCalendars.code, code))).limit(1));
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// SLA pauses
// ---------------------------------------------------------------------------

export async function openPause(tenantId: string, taskId: string): Promise<TaskSlaPauseRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(taskSlaPauses)
    .where(and(eq(taskSlaPauses.taskId, taskId), eq(taskSlaPauses.tenantId, tenantId), isNull(taskSlaPauses.resumedAt)))
    .limit(1));
  return rows[0] ?? null;
}

/**
 * Pause a task's SLA clock. Idempotent per task: the partial unique index
 * blocks a second open pause. Returns null when a pause is already open.
 */
export async function pauseTask(
  tenantId: string, taskId: string, reason: string | null, createdBy: string, now = new Date(),
): Promise<TaskSlaPauseRow | null> {
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(taskSlaPauses)
      .where(and(eq(taskSlaPauses.taskId, taskId), eq(taskSlaPauses.tenantId, tenantId), isNull(taskSlaPauses.resumedAt)))
      .for("update").limit(1);
    if (existing[0]) return null;
    const rows = await tx.insert(taskSlaPauses)
      .values({ tenantId, taskId, reason, createdBy, pausedAt: now })
      .returning();
    return rows[0]!;
  });
}

/**
 * Resume a paused SLA clock: close the open pause AND push the task's due_at
 * forward by the paused duration so the clock effectively did not tick while
 * paused. Returns the paused-minutes applied, or null if no open pause existed.
 */
export async function resumeTask(
  tenantId: string, taskId: string, now = new Date(),
): Promise<{ pausedMinutes: number } | null> {
  return db.transaction(async (tx) => {
    const open = await tx.select().from(taskSlaPauses)
      .where(and(eq(taskSlaPauses.taskId, taskId), eq(taskSlaPauses.tenantId, tenantId), isNull(taskSlaPauses.resumedAt)))
      .for("update").limit(1);
    const pause = open[0];
    if (!pause) return null;
    const pausedMs = now.getTime() - pause.pausedAt.getTime();
    const pausedMinutes = Math.max(0, Math.round(pausedMs / 60000));
    await tx.update(taskSlaPauses).set({ resumedAt: now }).where(eq(taskSlaPauses.id, pause.id));
    // shift due_at forward by the paused span so the SLA clock ignores the pause
    await tx.update(tasks)
      .set({ dueAt: sql`${tasks.dueAt} + (${pausedMs}::bigint * interval '1 millisecond')`, updatedAt: now })
      .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId), isNotNull(tasks.dueAt)));
    return { pausedMinutes };
  });
}

/** Total paused minutes (closed pauses) for a task — used for ageing. */
export async function totalPausedMinutes(tenantId: string, taskId: string, now = new Date()): Promise<number> {
  const rows = await scopedRead((tx) => tx.select().from(taskSlaPauses)
    .where(and(eq(taskSlaPauses.taskId, taskId), eq(taskSlaPauses.tenantId, tenantId))));
  let ms = 0;
  for (const p of rows) {
    const end = p.resumedAt ?? now;
    ms += Math.max(0, end.getTime() - p.pausedAt.getTime());
  }
  return Math.round(ms / 60000);
}

// ---------------------------------------------------------------------------
// Overdue queue + breach reporting (over the tasks table)
// ---------------------------------------------------------------------------

export interface OverdueRow {
  id: string;
  instanceId: string;
  name: string;
  roleRef: string | null;
  dueAt: Date | null;
  escalationCount: number;
}

/** Pending tasks past due_at (the overdue work queue), soonest-overdue first. */
export async function overdueTasks(tenantId: string, now = new Date(), limit = 200): Promise<OverdueRow[]> {
  const rows = await scopedRead((tx) => tx.select({
    id: tasks.id, instanceId: tasks.instanceId, name: tasks.name,
    roleRef: tasks.roleRef, dueAt: tasks.dueAt, escalationCount: tasks.escalationCount,
  }).from(tasks)
    .where(and(
      eq(tasks.tenantId, tenantId),
      eq(tasks.status, "pending"),
      isNotNull(tasks.dueAt),
      lte(tasks.dueAt, now),
    ))
    .orderBy(tasks.dueAt)
    .limit(limit));
  return rows;
}

export interface BreachSummary {
  totalOverdue: number;
  escalated: number;
  byRole: Array<{ roleRef: string | null; count: number }>;
}

/** Aggregate breach report: count of overdue tasks, escalated count, by role. */
export async function breachReport(tenantId: string, now = new Date()): Promise<BreachSummary> {
  const rows = await overdueTasks(tenantId, now, 10000);
  const byRoleMap = new Map<string | null, number>();
  let escalated = 0;
  for (const r of rows) {
    if (r.escalationCount > 0) escalated++;
    byRoleMap.set(r.roleRef, (byRoleMap.get(r.roleRef) ?? 0) + 1);
  }
  return {
    totalOverdue: rows.length,
    escalated,
    byRole: [...byRoleMap.entries()].map(([roleRef, count]) => ({ roleRef, count })),
  };
}
