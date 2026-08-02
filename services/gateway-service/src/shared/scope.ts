/**
 * Tenant-scoped transaction helper for gateway-native routes (F5).
 * Matches metadata-service shared/scope — sets app.tenant_id under FORCE RLS.
 */
import { sql } from "drizzle-orm";
import { db } from "./db.js";

const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!TENANT_ID_RE.test(tenantId)) throw new Error("withTenant: invalid tenantId");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as Tx);
  });
}
