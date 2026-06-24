import { eq, desc, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { activities, type ActivityRow, type ActivityInsert, type ActivityView } from "./schema.js";

export function toView(r: ActivityRow): ActivityView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    actorName: r.actorName,
    text: r.text,
    contactId: r.contactId,
    dealId: r.dealId,
    type: r.type,
    subject: r.subject,
    status: r.status,
    dueDate: r.dueDate ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listByTenant(tenantId: string, limit: number, offset: number, contactId?: string): Promise<ActivityView[]> {
  const conditions = contactId
    ? and(eq(activities.tenantId, tenantId), eq(activities.contactId, contactId))
    : eq(activities.tenantId, tenantId);
  const rows = await db.select().from(activities)
    .where(conditions)
    .orderBy(desc(activities.createdAt))
    .limit(limit)
    .offset(offset);
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
