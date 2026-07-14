/**
 * Cross-tenant maintenance scanner DB pool (BYPASSRLS).
 *
 * The scheduled workers in worker.ts (DPDP purge, no-show, overstay,
 * nightly-aggregation, auto-reject, recurring-pass-expiry, waiting-reminder,
 * device health, image-cleanup) must scan ALL tenants to find work. Under the
 * least-privilege visitor_svc role (NOBYPASSRLS) with FORCE ROW LEVEL SECURITY,
 * a bare cross-tenant SELECT returns ZERO rows because the tenant GUC is unset —
 * so every one of those workers silently no-ops in production.
 *
 * This module wires a SECOND pool that authenticates as the dedicated
 * `visitor_scanner` BYPASSRLS role (migration 0009). It is used for the
 * cross-tenant SELECT ONLY. Every WRITE that follows a scan runs on the primary
 * `db` (visitor_svc) inside `runWithTenant(row.tenantId, ...)`, so RLS still
 * re-checks each mutation and writes stay tenant-scoped.
 *
 * VISITOR_SCANNER_DATABASE_URL selects the scanner DSN. When unset it falls back
 * to DATABASE_URL — safe in dev, where the service connects as the RLS-inert
 * superuser and cross-tenant reads work regardless. In production/CI running as
 * the real NOBYPASSRLS role, VISITOR_SCANNER_DATABASE_URL MUST point at the
 * visitor_scanner role for the maintenance workers to see other tenants' rows.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { visitorSchemaMap } from "./db.js";

const scannerUrl = process.env.VISITOR_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!scannerUrl) {
  throw new Error(
    "VISITOR_SCANNER_DATABASE_URL or DATABASE_URL is required for the cross-tenant scanner pool",
  );
}

/** Dedicated postgres-js client for the BYPASSRLS scanner role. */
export const scannerSqlClient = createSqlClient(scannerUrl);

/**
 * Plain Drizzle handle over the scanner pool. NOT wrapped with the tenant-GUC
 * transaction hook — it deliberately bypasses RLS for read-only cross-tenant
 * scans. NEVER use this handle for writes.
 */
export const scannerDb = drizzle(scannerSqlClient, { schema: visitorSchemaMap });
