import { eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { dashboards, type DashboardRow, type DashboardView } from "./schema.js";
export function toView(r: DashboardRow): DashboardView {
  return { id: r.id, tenantId: r.tenantId, name: r.name, description: r.description, status: r.status, version: r.version };
}
export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<DashboardView[]> {
  const rows = await db.select().from(dashboards).where(eq(dashboards.tenantId, tenantId)).orderBy(desc(dashboards.updatedAt)).limit(limit).offset(offset);
  return rows.map(toView);
}
export type Writer = Pick<typeof db, "insert" | "update" | "select">;
