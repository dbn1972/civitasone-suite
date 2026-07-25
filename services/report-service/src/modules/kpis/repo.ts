import { eq, desc } from "drizzle-orm";
import { readScoped } from "../../shared/db.js";
import { kpis, type KpiRow } from "./schema.js";

export async function listByTenant(tenantId: string, limit: number): Promise<KpiRow[]> {
  return readScoped(tenantId, (tx) => tx.select().from(kpis)
    .where(eq(kpis.tenantId, tenantId))
    .orderBy(desc(kpis.createdAt))
    .limit(limit));
}
