/**
 * Tenant-scoped transaction helper for gateway-native routes (F5).
 * Thin alias over withTenantScope so catalogue call sites match the
 * fleet `withTenant(tenantId, tx => …)` pattern used by metadata/theme.
 */
import { withTenantScope } from "@civitasone/db";
import { db } from "./db.js";

export async function withTenant<T>(
  tenantId: string,
  fn: (tx: unknown) => Promise<T>,
): Promise<T> {
  return withTenantScope(db, tenantId, fn);
}
