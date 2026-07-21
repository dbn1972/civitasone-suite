import { eq, and, ne, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { projectProjects } from "../project/schema.js";

export async function getDashboard(tenantId: string) {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before these reads — bare db.select() calls run with no RLS GUC set.
  const [total, delayed, outlay] = await db.transaction(async (tx) => {
    const [total] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(projectProjects)
      .where(eq(projectProjects.tenantId, tenantId));

    const [delayed] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(projectProjects)
      .where(and(eq(projectProjects.tenantId, tenantId), eq(projectProjects.status, "delayed")));

    const [outlay] = await tx
      .select({ total: sql<number>`coalesce(sum(${projectProjects.sanctionedMinor}), 0)::bigint` })
      .from(projectProjects)
      .where(eq(projectProjects.tenantId, tenantId));

    return [total, delayed, outlay] as const;
  });

  const totalProjects = total?.count ?? 0;
  const delayedCount = delayed?.count ?? 0;

  return {
    totalProjects,
    onTrackPct: totalProjects > 0 ? Math.round(((totalProjects - delayedCount) / totalProjects) * 100) : 0,
    delayed: delayedCount,
    totalOutlay: Number(outlay?.total ?? 0) / 100,
  };
}
