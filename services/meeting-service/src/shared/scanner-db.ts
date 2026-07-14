/**
 * Cross-tenant maintenance scanner DB pool (BYPASSRLS).
 *
 * The scheduled workers (tenure-expiry, action-item-escalation, statutory-
 * frequency-check) must scan ALL tenants to find work. Under the least-privilege
 * meeting_svc role (NOBYPASSRLS) with FORCE ROW LEVEL SECURITY (migration 0005), a
 * bare cross-tenant SELECT returns ZERO rows because the tenant GUC is unset on the
 * worker's non-tenant discovery query — so every one of those workers silently
 * no-ops in production.
 *
 * This module wires a SECOND pool that authenticates as the dedicated
 * `meeting_scanner` BYPASSRLS role (migration 0007). It is used for the cross-tenant
 * SELECT ONLY. Every WRITE that follows a scan runs on the primary `db`
 * (meeting_svc) inside `runWithTenant(row.tenantId, ...)`, so RLS still re-checks
 * each mutation and writes stay tenant-scoped.
 *
 * MEETING_SCANNER_DATABASE_URL selects the scanner DSN. When unset it falls back to
 * DATABASE_URL — safe in dev, where the service connects as the RLS-inert superuser
 * and cross-tenant reads work regardless. In production/CI running as the real
 * NOBYPASSRLS role, MEETING_SCANNER_DATABASE_URL MUST point at the meeting_scanner
 * role for the maintenance workers to see other tenants' rows.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";

const scannerUrl = process.env.MEETING_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!scannerUrl) {
  throw new Error(
    "MEETING_SCANNER_DATABASE_URL or DATABASE_URL is required for the cross-tenant scanner pool",
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
