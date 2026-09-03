/**
 * Cross-tenant maintenance scanner DB pool (BYPASSRLS scanner role).
 *
 * worker.ts's expired-session reaper (sessions/repo.ts#reapExpiredSessions)
 * and break-glass TTL sweep (breakglass/repo.ts#sweepExpiredGrants) must scan
 * ALL tenants to find rows past their expiry. Under the least-privilege
 * identity_svc role (NOBYPASSRLS, #146) with FORCE RLS on sessions.sessions
 * and breakglass.grants, a bare cross-tenant SELECT/UPDATE returns/affects
 * ZERO rows because the tenant GUC is unset outside a request or a
 * runWithTenant()-wrapped consumer — both sweeps silently no-op in prod.
 *
 * Mirrors helpdesk-service's / visitor-service's shared/scanner-db.ts: a
 * SECOND pool authenticating as the dedicated identity_scanner BYPASSRLS role
 * (migration 0020), used for the cross-tenant SELECT ONLY. Every write that
 * follows a scan runs on the primary db under runWithTenant(tenantId, ...),
 * so RLS still applies to the actual mutation.
 *
 * IDENTITY_SCANNER_DATABASE_URL selects the scanner DSN. When unset it falls
 * back to DATABASE_URL — safe only where the connection role is already
 * RLS-inert. In production/CI running as the real NOBYPASSRLS identity_svc
 * role, it MUST point at the identity_scanner role for the sweeps to see
 * other tenants' rows.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";

const scannerUrl = process.env.IDENTITY_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.DB_URL;
if (!scannerUrl) {
  throw new Error(
    "IDENTITY_SCANNER_DATABASE_URL or DATABASE_URL is required for the cross-tenant scanner pool",
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
