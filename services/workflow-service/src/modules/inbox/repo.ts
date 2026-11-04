import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";
import { scopedRead, scopedExecute } from "../../shared/db.js";
import { tasks } from "../tasks/schema.js";
import { instances } from "../instances/schema.js";
import { taskVisibilityPredicate, toView } from "../tasks/repo.js";
import { participantFilterSql, type InstanceViewer } from "../instances/repo.js";
import type { TaskView } from "../tasks/schema.js";

/**
 * UX R1 (approvals inbox): the three tabs of the one approvals inbox.
 *  - waiting: tasks the caller may act on now. EXACTLY the visibility rule of the existing pending
 *    inbox (tasks/repo.ts listPendingForRoles / countPendingForRoles), so the sidebar badge, the tab
 *    count and GET /v1/workflow/tasks?status=pending agree.
 *  - sent: open steps of active instances the caller raised (they are the maker).
 *  - done: tasks the caller completed in the last DONE_WINDOW_DAYS days.
 */
export type InboxTab = "waiting" | "sent" | "done";
export const INBOX_TABS: readonly InboxTab[] = ["waiting", "sent", "done"];
export const DONE_WINDOW_DAYS = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InboxFilter = { refTypes?: readonly string[]; q?: string };
export type InboxRow = TaskView & { instanceName: string | null; requesterId: string | null; completedAt: string | null };
export type InboxCounts = { waiting: number; overdue: number; sent: number; done: number };

function likeOf(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function tabWhere(tenantId: string, tab: InboxTab, roles: readonly string[], actorId: string | undefined, f: InboxFilter = {}): SQL | undefined {
  const actor = actorId && UUID_RE.test(actorId) ? actorId : null;
  const parts: Array<SQL | undefined> = [eq(tasks.tenantId, tenantId)];
  if (tab === "waiting") {
    parts.push(eq(tasks.status, "pending"), eq(tasks.isCall, false), taskVisibilityPredicate(roles, actorId, "inbox"));
  } else if (tab === "sent") {
    if (!actor) return sql`false`;
    parts.push(eq(tasks.status, "pending"), eq(tasks.isCall, false), eq(instances.createdBy, actor), eq(instances.status, "active"));
  } else {
    if (!actor) return sql`false`;
    parts.push(
      eq(tasks.status, "completed"),
      eq(tasks.completedBy, actor),
      gte(tasks.updatedAt, sql`now() - make_interval(days => ${DONE_WINDOW_DAYS})`),
    );
  }
  if (f.refTypes && f.refTypes.length > 0) parts.push(inArray(tasks.refType, [...f.refTypes]));
  const q = f.q?.trim();
  if (q) parts.push(or(ilike(instances.name, likeOf(q)), ilike(tasks.name, likeOf(q))));
  return and(...parts);
}

/** One page of a tab. Waiting and sent: overdue first, then the nearest due date, then the oldest. */
export async function listInbox(
  tenantId: string, tab: InboxTab, roles: readonly string[], actorId: string | undefined,
  limit: number, offset: number, f: InboxFilter = {},
): Promise<InboxRow[]> {
  const where = tabWhere(tenantId, tab, roles, actorId, f);
  const order = tab === "done"
    ? [desc(tasks.updatedAt), asc(tasks.id)]
    : [sql`(${tasks.dueAt} IS NOT NULL AND ${tasks.dueAt} < now()) DESC`, sql`${tasks.dueAt} ASC NULLS LAST`, asc(tasks.createdAt), asc(tasks.id)];
  const rows = await scopedRead((tx) => tx.select({ task: tasks, instanceName: instances.name, requesterId: instances.createdBy })
    .from(tasks)
    .leftJoin(instances, and(eq(instances.id, tasks.instanceId), eq(instances.tenantId, tasks.tenantId)))
    .where(where)
    .orderBy(...order)
    .limit(limit)
    .offset(offset));
  return rows.map((r) => ({
    ...toView(r.task),
    instanceName: r.instanceName ?? null,
    requesterId: r.requesterId ?? null,
    completedAt: r.task.status === "completed" && r.task.updatedAt ? r.task.updatedAt.toISOString() : null,
  }));
}

/** Total of one tab under the same filter as listInbox (for "N of M" and paging). */
export async function countInbox(
  tenantId: string, tab: InboxTab, roles: readonly string[], actorId: string | undefined, f: InboxFilter = {},
): Promise<number> {
  const where = tabWhere(tenantId, tab, roles, actorId, f);
  const rows = await scopedRead((tx) => tx.select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .leftJoin(instances, and(eq(instances.id, tasks.instanceId), eq(instances.tenantId, tasks.tenantId)))
    .where(where));
  return rows[0]?.n ?? 0;
}

/** The unfiltered tab totals the tabs and the sidebar badge show, plus the overdue part of "waiting". */
export async function inboxCounts(tenantId: string, roles: readonly string[], actorId: string | undefined): Promise<InboxCounts> {
  const [waiting, sent, done] = await Promise.all(INBOX_TABS.map((t) => countInbox(tenantId, t, roles, actorId)));
  const overdueWhere = and(tabWhere(tenantId, "waiting", roles, actorId), isNotNull(tasks.dueAt), lt(tasks.dueAt, sql`now()`));
  const overdue = await scopedRead((tx) => tx.select({ n: sql<number>`count(*)::int` }).from(tasks).where(overdueWhere));
  return { waiting: waiting ?? 0, overdue: overdue[0]?.n ?? 0, sent: sent ?? 0, done: done ?? 0 };
}

/** A workflow instance a summary can be built on, with what the stage line needs. */
export type RefInstance = {
  instanceId: string;
  refType: string;
  refId: string;
  name: string;
  status: string;
  createdBy: string;
  createdAt: string;
  /** Human task steps in the definition (0 when the definition is unknown). */
  levels: number;
  /** Completed human steps on this instance. */
  doneSteps: number;
  /** Name of the step that is open now, if any. */
  currentStep: string | null;
};

/**
 * The instances behind a batch of business refs that the VIEWER participates in, in ONE statement.
 * Participation is the #2445 gate (participantFilterSql: requester, or holder / assignee /
 * completer of one of its tasks; super_admin and workflow_admin unscoped). A ref the viewer does not
 * participate in yields no row, so no summary is ever built for it. When a record has several
 * instances (raised again after a return), the active one wins, then the newest.
 */
export async function participantInstancesForRefs(
  tenantId: string,
  refs: ReadonlyArray<{ refType: string; refId: string }>,
  viewer: InstanceViewer,
): Promise<RefInstance[]> {
  const valid = refs.filter((r) => UUID_RE.test(r.refId) && r.refType.length > 0 && r.refType.length <= 64);
  if (valid.length === 0) return [];
  const pairs = sql.join(valid.map((r) => sql`(${r.refType}::text, ${r.refId}::uuid)`), sql`, `);
  const rows = (await scopedExecute(sql`
    SELECT DISTINCT ON (i.ref_type, i.ref_id)
           i.id, i.ref_type, i.ref_id, i.name, i.status, i.created_by, i.created_at,
           (SELECT count(*)::int FROM workflow.definition_nodes n
             WHERE n.definition_id = i.definition_id AND n.node_type = ${"task"}) AS levels,
           (SELECT count(*)::int FROM workflow.tasks d
             WHERE d.instance_id = i.id AND d.tenant_id = i.tenant_id AND d.status = ${"completed"} AND d.is_call = false) AS done_steps,
           (SELECT o.name FROM workflow.tasks o
             WHERE o.instance_id = i.id AND o.tenant_id = i.tenant_id AND o.status = ${"pending"} AND o.is_call = false
             ORDER BY o.created_at ASC LIMIT 1) AS current_step
    FROM workflow.instances i
    WHERE i.tenant_id = ${tenantId}
      AND (i.ref_type, i.ref_id) IN (${pairs})${participantFilterSql(viewer)}
    ORDER BY i.ref_type, i.ref_id, (i.status = ${"active"}) DESC, i.created_at DESC
  `)) as unknown as Array<{
    id: string; ref_type: string; ref_id: string; name: string; status: string; created_by: string; created_at: Date | string;
    levels: number | null; done_steps: number | null; current_step: string | null;
  }>;
  return rows.map((r) => ({
    instanceId: r.id,
    refType: r.ref_type,
    refId: r.ref_id,
    name: r.name,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    levels: Number(r.levels ?? 0),
    doneSteps: Number(r.done_steps ?? 0),
    currentStep: r.current_step ?? null,
  }));
}
