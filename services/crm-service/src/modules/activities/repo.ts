import { eq, desc, and, sql, type SQL } from "drizzle-orm";
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
): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
  return scopedRead(async (tx) => {
    const where = sql`a.tenant_id = ${tenantId} AND a.type = 'task' AND a.status = 'open'
      AND a.due_date IS NOT NULL AND a.due_date < (now() AT TIME ZONE 'Asia/Kolkata')::date`;
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
