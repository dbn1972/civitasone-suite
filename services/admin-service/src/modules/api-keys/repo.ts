import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { adminApiKeys, type ApiKeyRow } from "./schema.js";

export async function listByTenant(tenantId: string, limit: number): Promise<ApiKeyRow[]> {
  return db.select().from(adminApiKeys)
    .where(eq(adminApiKeys.tenantId, tenantId))
    .limit(limit);
}
