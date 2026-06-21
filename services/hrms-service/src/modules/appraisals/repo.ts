import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { hrmsAppraisals, type AppraisalRow } from "./schema.js";

export async function listByTenant(tenantId: string, limit = 100): Promise<AppraisalRow[]> {
  return db.select().from(hrmsAppraisals)
    .where(eq(hrmsAppraisals.tenantId, tenantId))
    .limit(limit);
}
