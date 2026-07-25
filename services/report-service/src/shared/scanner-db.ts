/**
 * Cross-tenant maintenance scanner DB pool (BYPASSRLS) — mirrors
 * meeting-service/src/shared/scanner-db.ts.
 *
 * The scheduled-report cron (scheduled/cron.ts tick) must scan ALL tenants for
 * due reports. Under the least-privilege report_svc role (NOBYPASSRLS, #146)
 * with FORCE ROW LEVEL SECURITY, that bare cross-tenant SELECT errors/returns
 * ZERO rows — the sweep silently no-ops in production.
 *
 * This second pool authenticates as the dedicated `report_scanner` BYPASSRLS
 * role (migration 0014) and is used for the cross-tenant SELECT ONLY. Every
 * WRITE that follows runs on the primary `db` (report_svc) inside
 * `runWithTenant(row.tenantId, ...)`, so RLS still re-checks each mutation.
 *
 * REPORT_SCANNER_DATABASE_URL selects the scanner DSN; falls back to
 * DATABASE_URL (safe in dev where the service connects as the RLS-inert
 * superuser). In production/CI it MUST point at the report_scanner role.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";

const scannerUrl = process.env.REPORT_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!scannerUrl) {
  throw new Error(
    "REPORT_SCANNER_DATABASE_URL or DATABASE_URL is required for the cross-tenant scanner pool",
  );
}

/** Dedicated postgres-js client for the BYPASSRLS scanner role. */
export const scannerSqlClient = createSqlClient(scannerUrl);

/**
 * Plain Drizzle handle over the scanner pool. NOT wrapped with the tenant-GUC
 * transaction hook — it deliberately bypasses RLS for read-only cross-tenant scans.
 * NEVER use this handle for writes.
 */
export const scannerDb = drizzle(scannerSqlClient, { schema: {} });
