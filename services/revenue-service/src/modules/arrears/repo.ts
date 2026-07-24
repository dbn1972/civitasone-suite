import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { instalmentPlans } from "./schema.js";
import { eq, and, desc } from "drizzle-orm";
import { SERVICE } from "../../topics.js";

export async function listInstalmentPlans(
  tenantId: string,
  assesseeId: string,
  pagination: { limit: number; offset: number },
) {
  const rows = await cache.getOrLoad(`${SERVICE}:${tenantId}:instalments:${assesseeId}`, async () => {
    return db
      .select()
      .from(instalmentPlans)
      .where(and(eq(instalmentPlans.tenantId, tenantId), eq(instalmentPlans.assesseeId, assesseeId)))
      .orderBy(desc(instalmentPlans.createdAt));
  });
  return rows ?? [];
}
