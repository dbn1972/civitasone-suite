import { eq, desc, and, sql, type SQL } from "drizzle-orm";
import { ownerVisibleSql } from "../../shared/team-scope.js";
import type { ActivityFeedQuery } from "./validators.js";
import { db, scopedRead } from "../../shared/db.js";
import { activities, type ActivityRow, type ActivityInsert, type ActivityView } from "./schema.js";

export function toView(r: ActivityRow): ActivityView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    actorName: r.actorName,
    text: r.text,
    contactId: r.contactId,
    dealId: r.dealId,
    accountId: r.accountId,
    type: r.type,
    subject: r.subject,
    status: r.status,
    dueDate: r.dueDate ?? null,
    remindAt: r.remindAt?.toISOString() ?? null,
    location: r.location ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export type ActivitySubjectType = "contact" | "deal" | "account";

/**
 * The per-record timeline: activities for exactly one subject, tenant-scoped.
 * subjectType picks the column so a contact page never sees a deal's or another
 * contact's activities (same-tenant isolation), and RLS scopes the tenant.
 */
export async function listBySubject(
  tenantId: string,
  subjectType: ActivitySubjectType,
  subjectId: string,
  limit: number,
  offset: number,
): Promise<ActivityView[]> {
  const subjectCol =
    subjectType === "contact" ? activities.contactId
    : subjectType === "deal" ? activities.dealId
    : activities.accountId;
  const where: SQL = and(
    eq(activities.tenantId, tenantId),
    eq(subjectCol, subjectId),
  ) as SQL;
  const rows = await scopedRead((tx) => tx.select().from(activities)
    .where(where)
    .orderBy(desc(activities.createdAt))
    .limit(limit)
    .offset(offset));
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: ActivityInsert): Promise<void> {
  await tx.insert(activities).values(row);
}

/** P1-3: patch activity status/completedAt. completedAt auto-set on complete. */
export async function updateActivity(
  tx: Writer,
  id: string,
  tenantId: string,
  fields: { status?: string; completedAt?: Date | null; dueDate?: string; ownerId?: string },
  actorId?: string,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (fields.status !== undefined) {
    patch.status = fields.status;
    // Auto-set completedAt when transitioning to completed (unless caller gave one).
    if (fields.status === "completed" && fields.completedAt === undefined) {
      patch.completedAt = new Date();
    }
  }
  if (fields.completedAt !== undefined) patch.completedAt = fields.completedAt;
  // GAP-CRM-TASK-ESCALATION-06: snooze — push the due date out.
  if (fields.dueDate !== undefined) patch.dueDate = fields.dueDate;
  // GAP-CRM-TASK-ESCALATION-06: reassign.
  if (fields.ownerId !== undefined) patch.ownerId = fields.ownerId;
  if (Object.keys(patch).length === 0) return;
  // Every CRM update bumps the optimistic-lock version and stamps who/when changed it.
  patch.version = sql`${activities.version} + 1`;
  patch.updatedAt = new Date();
  if (actorId !== undefined) patch.updatedBy = actorId;
  await (tx as typeof db).update(activities)
    .set(patch)
    .where(and(eq(activities.id, id), eq(activities.tenantId, tenantId)));
}

/**
 * The current owner of an activity (owner_id, else its creator), or null when the activity does
 * not exist in this tenant. Used to authorise a reassign.
 */
export async function findOwner(tenantId: string, id: string): Promise<{ ownerId: string | null } | null> {
  const rows = await scopedRead((tx) => tx.select({ ownerId: activities.ownerId, createdBy: activities.createdBy })
    .from(activities)
    .where(and(eq(activities.id, id), eq(activities.tenantId, tenantId)))
    .limit(1));
  const r = rows[0];
  return r ? { ownerId: (r.ownerId ?? r.createdBy ?? null) as string | null } : null;
}

/**
 * GAP-CRM-TASK-ESCALATION-06: open tasks whose due date is before today (IST),
 * oldest first. Tenant-scoped explicitly and by RLS. The owner is
 * COALESCE(owner_id, created_by) — an id only; names are resolved web-side.
 */
export async function listOverdueTasks(
  tenantId: string,
  limit: number,
  offset: number,
  minAgeMinutes?: number,
): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
  return scopedRead(async (tx) => {
    // `minAgeMinutes` mirrors the escalation scheduler: a task-type activity's DATE
    // due_date is treated as end-of-day UTC, and a rule fires once the task is at
    // least `threshold` minutes past that instant.
    const ageF =
      minAgeMinutes !== undefined && minAgeMinutes > 0
        ? sql`AND now() >= ((a.due_date + time '23:59:59') AT TIME ZONE 'UTC') + make_interval(mins => ${minAgeMinutes})`
        : sql``;
    const where = sql`a.tenant_id = ${tenantId} AND a.type = 'task' AND a.status = 'open'
      AND a.due_date IS NOT NULL AND a.due_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
      ${ageF}`;
    const rows = (await tx.execute(sql`
      SELECT a.id, a.subject, a.text, a.due_date::text AS "dueDate",
             COALESCE(a.owner_id, a.created_by) AS "ownerId",
             CASE WHEN a.contact_id IS NOT NULL THEN 'contact'
                  WHEN a.deal_id    IS NOT NULL THEN 'deal'
                  WHEN a.account_id IS NOT NULL THEN 'account' END AS "subjectType",
             COALESCE(a.contact_id, a.deal_id, a.account_id) AS "subjectId"
      FROM crm.activities a
      WHERE ${where}
      ORDER BY a.due_date ASC, a.created_at ASC
      LIMIT ${limit} OFFSET ${offset}
    `)) as unknown as Array<Record<string, unknown>>;
    const [ct] = (await tx.execute(sql`SELECT count(*)::int AS total FROM crm.activities a WHERE ${where}`)) as unknown as Array<{ total: number }>;
    return { rows, total: ct?.total ?? 0 };
  });
}

export interface FeedRow {
  id: string; tenantId: string; actorName: string; text: string;
  contactId: string | null; dealId: string | null; accountId: string | null;
  type: string; subject: string | null; status: string;
  dueDate: string | null; remindAt: string | null; location: string | null;
  completedAt: string | null; createdAt: string;
  ownerId: string | null; relatedName: string | null;
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => "\\" + c);

/**
 * Scoped activity feed. Tenant is ALWAYS filtered (and RLS applies). When `actorId` is given
 * (non-admin) the rows are limited to activities the actor owns (COALESCE(owner_id, created_by),
 * i.e. owner or assignee) or that belong to a contact/deal/account whose owner_id is the actor -
 * the only record-ownership scoping this module has. Admins pass actorId=null for the tenant.
 */
export async function listFeed(
  tenantId: string,
  actorId: string | null,
  q: ActivityFeedQuery,
  callerId: string,
): Promise<{ rows: FeedRow[]; total: number }> {
  const conds: SQL[] = [sql`a.tenant_id = ${tenantId}`];
  if (actorId) {
    // Own records PLUS records owned by members of the caller's team(s) (crm.team_members).
    const own = (col: string) => ownerVisibleSql(sql.raw(col), tenantId, actorId, false);
    conds.push(sql`(${own("COALESCE(a.owner_id, a.created_by)")} OR ${own("c.owner_id")} OR ${own("d.owner_id")} OR ${own("ac.owner_id")})`);
  }
  if (q.type) conds.push(sql`a.type = ${q.type}`);
  if (q.status === "overdue") conds.push(sql`(a.status = 'open' AND a.due_date < (now() AT TIME ZONE 'Asia/Kolkata')::date)`);
  else if (q.status === "open") conds.push(sql`(a.status = 'open' AND (a.due_date IS NULL OR a.due_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date))`);
  else if (q.status) conds.push(sql`a.status = ${q.status}`);
  if (q.ownerId) conds.push(sql`COALESCE(a.owner_id, a.created_by) = ${q.ownerId}`);
  if (q.mine) conds.push(sql`COALESCE(a.owner_id, a.created_by) = ${callerId}`);
  if (q.relatedType === "contact") conds.push(sql`a.contact_id IS NOT NULL`);
  else if (q.relatedType === "deal") conds.push(sql`a.deal_id IS NOT NULL`);
  else if (q.relatedType === "account") conds.push(sql`a.account_id IS NOT NULL`);
  if (q.dueFrom) conds.push(sql`a.due_date >= ${q.dueFrom}::date`);
  if (q.dueTo) conds.push(sql`a.due_date <= ${q.dueTo}::date`);
  if (q.q) {
    const like = "%" + escapeLike(q.q) + "%";
    conds.push(sql`(a.subject ILIKE ${like} OR a.text ILIKE ${like})`);
  }
  const where = sql.join(conds, sql` AND `);
  const from = sql`FROM crm.activities a
      LEFT JOIN crm.contacts c ON c.id = a.contact_id AND c.tenant_id = a.tenant_id
      LEFT JOIN crm.deals d ON d.id = a.deal_id AND d.tenant_id = a.tenant_id
      LEFT JOIN crm.accounts ac ON ac.id = a.account_id AND ac.tenant_id = a.tenant_id`;
  return scopedRead(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT a.id, a.tenant_id AS "tenantId", a.actor_name AS "actorName", a.text,
             a.contact_id AS "contactId", a.deal_id AS "dealId", a.account_id AS "accountId",
             a.type, a.subject,
             CASE WHEN a.status = 'open' AND a.due_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
                  THEN 'overdue' ELSE a.status END AS status,
             a.due_date::text AS "dueDate", a.remind_at AS "remindAt", a.location,
             a.completed_at AS "completedAt", a.created_at AS "createdAt",
             COALESCE(a.owner_id, a.created_by) AS "ownerId",
             COALESCE(c.name, d.name, ac.name) AS "relatedName"
      ${from}
      WHERE ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `)) as unknown as Array<Record<string, unknown>>;
    const [ct] = (await tx.execute(sql`SELECT count(*)::int AS total ${from} WHERE ${where}`)) as unknown as Array<{ total: number }>;
    const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
    return {
      rows: rows.map((r) => ({
        ...(r as unknown as FeedRow),
        remindAt: iso(r["remindAt"]),
        completedAt: iso(r["completedAt"]),
        createdAt: iso(r["createdAt"]) as string,
      })),
      total: ct?.total ?? 0,
    };
  });
}
