import { eq, and, ne, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { projectProjects } from "../project/schema.js";

export async function getDashboard(tenantId: string) {
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectProjects)
    .where(eq(projectProjects.tenantId, tenantId));

  const [delayed] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectProjects)
    .where(and(eq(projectProjects.tenantId, tenantId), eq(projectProjects.status, "delayed")));

  const [outlay] = await db
    .select({ total: sql<number>`coalesce(sum(${projectProjects.sanctionedMinor}), 0)::bigint` })
    .from(projectProjects)
    .where(eq(projectProjects.tenantId, tenantId));

  const totalProjects = total?.count ?? 0;
  const delayedCount = delayed?.count ?? 0;

  return {
    totalProjects,
    onTrackPct: totalProjects > 0 ? Math.round(((totalProjects - delayedCount) / totalProjects) * 100) : 0,
    delayed: delayedCount,
    totalOutlay: Number(outlay?.total ?? 0) / 100,
  };
}
