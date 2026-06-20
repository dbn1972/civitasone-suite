import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { assetAssets } from "../register/schema.js";

export async function getDashboard(tenantId: string) {
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(assetAssets)
    .where(eq(assetAssets.tenantId, tenantId));

  const [maintenance] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(assetAssets)
    .where(and(eq(assetAssets.tenantId, tenantId), eq(assetAssets.status, "maintenance")));

  return {
    totalAssets: total?.count ?? 0,
    underMaintenance: maintenance?.count ?? 0,
    dueForDisposal: 0,
    netBlock: 0,
  };
}
