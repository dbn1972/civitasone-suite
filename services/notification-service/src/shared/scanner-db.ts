/**
 * Cross-tenant maintenance scanner DB pool (BYPASSRLS) — mirrors
 * meeting-service/src/shared/scanner-db.ts.
 *
 * The sweepers (delivery retry, schedule dispatch, digest flush, DND release)
 * must scan ALL tenants to find due work. Under the least-privilege
 * notification_svc role (NOBYPASSRLS, #146) with FORCE ROW LEVEL SECURITY
 * (migration 0007), a bare cross-tenant SELECT returns ZERO rows because the
 * tenant GUC is unset on the discovery query — every sweep silently no-ops.
 *
 * This second pool authenticates as the dedicated `notification_scanner`
 * BYPASSRLS role (migration 0024) and is used for the cross-tenant SELECT ONLY.
 * Every WRITE that follows a scan runs on the primary `db` (notification_svc)
 * inside `runWithTenant(row.tenantId, ...)`, so RLS still re-checks each
 * mutation and writes stay tenant-scoped.
 *
 * NOTIFICATION_SCANNER_DATABASE_URL selects the scanner DSN. When unset it
 * falls back to DATABASE_URL — safe in dev where the service connects as the
 * RLS-inert superuser. In production/CI running as the real NOBYPASSRLS role,
 * NOTIFICATION_SCANNER_DATABASE_URL MUST point at the notification_scanner role.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";

const scannerUrl = process.env.NOTIFICATION_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!scannerUrl) {
  throw new Error(
    "NOTIFICATION_SCANNER_DATABASE_URL or DATABASE_URL is required for the cross-tenant scanner pool",
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
