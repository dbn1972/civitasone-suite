/**
 * Cross-tenant maintenance scanner DB pool (BYPASSRLS scanner role).
 *
 * The SLA-breach sweeper (tickets/repo.ts#findOpenForSla) and the catalogue
 * breach sweeper (catalogue/repo.ts#findOverdueOpenRequests) must scan ALL
 * tenants to find due work. Under the least-privilege helpdesk_svc role
 * (NOBYPASSRLS, #146) with FORCE RLS, a bare cross-tenant SELECT returns ZERO
 * rows because the tenant GUC is unset — both sweepers silently no-op in prod.
 *
 * Mirrors visitor-service's shared/scanner-db.ts: a SECOND pool authenticating
 * as the dedicated helpdesk_scanner BYPASSRLS role (migration 0016), used for
 * the cross-tenant SELECT ONLY. Every write that follows a scan runs on the
 * primary db under runWithTenant(row.tenantId, ...), so RLS still applies.
 *
 * HELPDESK_SCANNER_DATABASE_URL selects the scanner DSN. When unset it falls back
 * to DATABASE_URL — safe in dev where the connection role is RLS-inert. In
 * production/CI running as the real NOBYPASSRLS role, it MUST point at the
 * scanner role for the sweepers to see other tenants' rows.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";

const scannerUrl = process.env.HELPDESK_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!scannerUrl) {
  throw new Error(
    "HELPDESK_SCANNER_DATABASE_URL or DATABASE_URL is required for the cross-tenant scanner pool",
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
