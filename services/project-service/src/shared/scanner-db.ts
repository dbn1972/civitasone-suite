/**
 * Cross-tenant maintenance scanner DB pool (BYPASSRLS) — mirrors
 * meeting-service/src/shared/scanner-db.ts.
 *
 * The RAG scheduler sweep (rag.ts runRagTick -> repo.listActiveProjects)
 * deliberately polls active projects across ALL tenants. Under the
 * least-privilege project_svc role (NOBYPASSRLS, #146) with FORCE ROW LEVEL
 * SECURITY, that bare cross-tenant SELECT returns ZERO rows — the sweep
 * silently no-ops in production.
 *
 * This second pool authenticates as the dedicated `project_scanner` BYPASSRLS
 * role (migration 0019) and is used for the cross-tenant SELECT ONLY. Every
 * WRITE derived from the scan runs on the primary `db` (project_svc) inside
 * `runWithTenant(project.tenantId, ...)`, so RLS still re-checks each mutation.
 *
 * PROJECT_SCANNER_DATABASE_URL selects the scanner DSN; falls back to
 * DATABASE_URL (safe in dev where the service connects as the RLS-inert
 * superuser). In production/CI it MUST point at the project_scanner role.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";

const scannerUrl = process.env.PROJECT_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!scannerUrl) {
  throw new Error(
    "PROJECT_SCANNER_DATABASE_URL or DATABASE_URL is required for the cross-tenant scanner pool",
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
