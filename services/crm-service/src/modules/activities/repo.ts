import { eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { activities, type ActivityRow, type ActivityInsert, type ActivityView } from "./schema.js";

export function toView(r: ActivityRow): ActivityView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    actorName: r.actorName,
    text: r.text,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<ActivityView[]> {
  const rows = await db.select().from(activities)
    .where(eq(activities.tenantId, tenantId))
    .orderBy(desc(activities.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: ActivityInsert): Promise<void> {
  await tx.insert(activities).values(row);
}
