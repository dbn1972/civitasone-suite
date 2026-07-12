import { withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";

/**
 * Run a direct DB operation with the tenant GUC (`app.tenant_id`) set, so reads
 * and writes against FORCE ROW LEVEL SECURITY tables are scoped to `tenantId`.
 *
 * Routes/consumers establish this tenant context at runtime (request hook /
 * runWithTenant + db.transaction). Test setup and readbacks that hit RLS tables
 * bypass that lifecycle, so they must use this helper instead of the bare `db`,
 * otherwise the RLS policy (tenant_id = current_tenant_id()) filters every row
 * (reads return empty) or rejects the write (WITH CHECK violation).
 */
export function scoped<T>(tenantId: string, fn: (tx: any) => Promise<T>): Promise<T> {
  return withTenantScope(db, tenantId, fn);
}
