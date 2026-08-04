import { eq, desc, and, type SQL } from "drizzle-orm";
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
  fields: { status?: string; completedAt?: Date | null },
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
  if (Object.keys(patch).length === 0) return;
  await (tx as typeof db).update(activities)
    .set(patch)
    .where(and(eq(activities.id, id), eq(activities.tenantId, tenantId)));
}
