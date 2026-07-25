/**
 * Cross-tenant maintenance scanner DB pool (BYPASSRLS scanner role).
 *
 * The depreciation scheduler (src/modules/depreciation/scheduler.ts) must scan
 * ALL tenants to find (tenant, period) pairs with unposted entries. Under the
 * least-privilege asset_svc role (NOBYPASSRLS, #146) with FORCE ROW LEVEL
 * SECURITY, a bare cross-tenant SELECT returns ZERO rows because the tenant GUC
 * is unset — the scheduler would silently no-op in production.
 *
 * Mirrors visitor-service's shared/scanner-db.ts: a SECOND pool authenticating
 * as a dedicated BYPASSRLS scanner role, used for the cross-tenant SELECT ONLY.
 * Every write that follows a scan is a queue command consumed under
 * runWithTenant(row.tenantId, ...), so RLS still re-checks each mutation.
 *
 * ASSET_SCANNER_DATABASE_URL selects the scanner DSN. When unset it falls back
 * to DATABASE_URL — safe in dev where the connection role is RLS-inert. In
 * production/CI running as the real NOBYPASSRLS role, it MUST point at the
 * scanner role for the scheduler to see other tenants' rows.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";

const scannerUrl = process.env.ASSET_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!scannerUrl) {
  throw new Error(
    "ASSET_SCANNER_DATABASE_URL or DATABASE_URL is required for the cross-tenant scanner pool",
  );
}

/** Dedicated postgres-js client for the BYPASSRLS scanner role. */
export const scannerSqlClient = createSqlClient(scannerUrl);

/**
 * Plain Drizzle handle over the scanner pool. NOT wrapped with the tenant-GUC
 * transaction hook — it deliberately bypasses RLS for read-only cross-tenant
 * scans. NEVER use this handle for writes.
 */
export const scannerDb = drizzle(scannerSqlClient);
