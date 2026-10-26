/**
 * Cross-tenant maintenance scanner DB pool (BYPASSRLS, READ-ONLY) — mirrors
 * report-service/src/shared/scanner-db.ts.
 *
 * The assistant-interaction retention purge must discover which tenants have
 * expired rows. Under knowledge_svc (NOBYPASSRLS) with FORCE ROW LEVEL SECURITY a
 * bare cross-tenant SELECT returns ZERO rows and the sweep would silently no-op.
 * This pool authenticates as `knowledge_scanner` (migration 0018) and is used
 * for discovery SELECTs ONLY. Every write runs on the primary `db` inside
 * runWithTenant(tenantId, ...) so RLS re-checks each mutation.
 *
 * KNOWLEDGE_SCANNER_DATABASE_URL selects the scanner DSN; falls back to
 * DATABASE_URL (dev only, where the service connects as an RLS-inert superuser).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";

const scannerUrl = process.env.KNOWLEDGE_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!scannerUrl) {
  throw new Error("KNOWLEDGE_SCANNER_DATABASE_URL or DATABASE_URL is required for the cross-tenant scanner pool");
}

/** Dedicated postgres-js client for the BYPASSRLS scanner role. */
export const scannerSqlClient = createSqlClient(scannerUrl);

/** Plain Drizzle handle over the scanner pool. NEVER use it for writes. */
export const scannerDb = drizzle(scannerSqlClient, { schema: {} });
