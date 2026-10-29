/**
 * Tenant-scoped standalone READ for FORCE-RLS tables.
 *
 * theme tables carry `tenant_id = current_tenant_id()` policies under the
 * NOBYPASSRLS theme_svc role. A bare `db.select()` runs on a pooled connection
 * with no `app.tenant_id` GUC, so it matched ZERO rows: tokens, templates,
 * revisions/latest and branding all read back empty after a successful write
 * (UAT FQ12 #150 #151 #154). Establish the tenant context explicitly from the
 * caller's (JWT) tenant and read inside a GUC transaction — the same pattern
 * brand-repo.findByTenant and report-service readScoped use. Nesting inside an
 * identical context is harmless.
 */
import { runWithTenant } from "@civitasone/db";
import { db, type Db } from "./db.js";

export type ScopedTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function readScoped<T>(tenantId: string, fn: (tx: ScopedTx) => PromiseLike<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn as (tx: ScopedTx) => Promise<T>)) as Promise<T>;
}
