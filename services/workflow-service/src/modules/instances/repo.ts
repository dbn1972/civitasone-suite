import { eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { instances, type InstanceRow, type InstanceInsert, type InstanceView } from "./schema.js";

export function toView(r: InstanceRow): InstanceView {
  return { id: r.id, tenantId: r.tenantId, name: r.name, status: r.status, version: r.version };
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<InstanceView[]> {
  const rows = await db.select().from(instances)
    .where(eq(instances.tenantId, tenantId))
    .orderBy(desc(instances.updatedAt))
    .limit(limit).offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: InstanceInsert): Promise<void> {
  await tx.insert(instances).values(row);
}
