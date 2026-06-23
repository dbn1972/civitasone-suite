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
