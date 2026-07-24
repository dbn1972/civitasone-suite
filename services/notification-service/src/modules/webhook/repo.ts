import { eq, and } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { webhookEndpoints } from "./schema.js";

/** Find all enabled webhook endpoints for a tenant. */
export async function findEndpointByTenant(
  tenantId: string,
): Promise<typeof webhookEndpoints.$inferSelect[]> {
  return scopedRead((tx) =>
    tx.select().from(webhookEndpoints)
      .where(and(
        eq(webhookEndpoints.tenantId, tenantId),
        eq(webhookEndpoints.enabled, true),
      )),
  );
}

/** Find a specific webhook endpoint by tenant and ID. */
export async function findEndpointById(
  tenantId: string, id: string,
): Promise<typeof webhookEndpoints.$inferSelect | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(webhookEndpoints)
      .where(and(
        eq(webhookEndpoints.tenantId, tenantId),
        eq(webhookEndpoints.id, id),
      ))
      .limit(1),
  );
  return rows[0] ?? null;
}

/** List all webhook endpoints for a tenant (including disabled). */
export async function listEndpoints(
  tenantId: string,
): Promise<typeof webhookEndpoints.$inferSelect[]> {
  return scopedRead((tx) =>
    tx.select().from(webhookEndpoints)
      .where(eq(webhookEndpoints.tenantId, tenantId)),
  );
}
