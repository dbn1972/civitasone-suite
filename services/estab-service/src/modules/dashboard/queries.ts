import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabFiles } from "../files/schema.js";

export async function getDashboard(tenantId: string) {
  const [pendingFiles] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(estabFiles)
    .where(and(eq(estabFiles.tenantId, tenantId), eq(estabFiles.status, "active")));

  return {
    filesPending: pendingFiles?.count ?? 0,
    meetingsToday: 0,
    vehiclesInUse: 0,
    complianceItemsDue: 0,
  };
}
