/**
 * shared/scanner-db.ts — read-only cross-tenant scan pool.
 *
 * The wait sweeper has to find parked `wait` steps across every tenant, and it
 * has no tenant context of its own. Under `journey_svc` (NOBYPASSRLS) a scan
 * with no `app.tenant_id` GUC returns ZERO rows, which would make wait steps
 * park forever and silently never resume. This pool exists solely so that scan
 * works; each resume is then published as a per-tenant command, so the WRITE
 * still runs under the row's tenant and RLS re-checks it.
 *
 * JOURNEY_SCANNER_DATABASE_URL selects the scanner DSN. When unset it falls back
 * to DATABASE_URL — safe in dev where the service connects as the RLS-inert
 * superuser. In production running as the real NOBYPASSRLS role,
 * JOURNEY_SCANNER_DATABASE_URL MUST point at a BYPASSRLS scanner role.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";

const scannerUrl = process.env.JOURNEY_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!scannerUrl) {
  throw new Error("JOURNEY_SCANNER_DATABASE_URL or DATABASE_URL is required for the cross-tenant scanner pool");
}

/** Dedicated postgres-js client for the scanner role. */
export const scannerSqlClient = createSqlClient(scannerUrl);

/**
 * Plain Drizzle handle over the scanner pool. NOT wrapped with the tenant-GUC
 * transaction hook — it deliberately bypasses RLS for read-only cross-tenant
 * scans. NEVER use this handle for writes.
 */
export const scannerDb = drizzle(scannerSqlClient, { schema: {} });
