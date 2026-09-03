/**
 * Cross-tenant maintenance scanner DB pool (BYPASSRLS) — mirrors
 * notification-service/src/shared/scanner-db.ts and
 * meeting-service/src/shared/scanner-db.ts.
 *
 * The lead-ingestion scheduler must scan ALL tenants to discover which ones
 * have an enabled sftp connector flagged as a lead source (BRD §9 #12).
 * Under the least-privilege admin_svc role (NOBYPASSRLS, 0018) with FORCE
 * ROW LEVEL SECURITY on integration_settings.integration_settings (0021), a
 * bare discovery query with no app.tenant_id GUC set returns ZERO rows —
 * every scheduled sweep silently no-oped in production. list_sftp_lead_
 * source_tenants() (migration 0029) being SECURITY DEFINER did not help:
 * SECURITY DEFINER evaluates RLS as the function's OWNER, not the caller, and
 * the owner was admin_svc (NOBYPASSRLS) — see migration 0030 for the full
 * root-cause note.
 *
 * This second pool authenticates as the dedicated `admin_scanner` BYPASSRLS
 * role (migration 0030, which also switches the function to SECURITY
 * INVOKER so the CALLING role's privileges govern RLS) and is used for the
 * cross-tenant discovery SELECT ONLY. Every per-tenant read/write that
 * follows a scan still runs on the primary `db`/`sqlClient` (admin_svc)
 * inside the tenant-scoped path (runIngestion → the tenant GUC transaction),
 * so RLS still re-checks every mutation and per-tenant work stays isolated.
 *
 * ADMIN_SCANNER_DATABASE_URL selects the scanner DSN. When unset it falls
 * back to DATABASE_URL — safe in dev/tests where the service often connects
 * as the RLS-inert superuser. In production, running as the real NOBYPASSRLS
 * admin_svc role, ADMIN_SCANNER_DATABASE_URL MUST point at the admin_scanner
 * role.
 */
import { createSqlClient } from "@civitasone/db";

const scannerUrl = process.env.ADMIN_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!scannerUrl) {
  throw new Error(
    "ADMIN_SCANNER_DATABASE_URL or DATABASE_URL is required for the cross-tenant scanner pool",
  );
}

/**
 * Dedicated postgres-js client for the BYPASSRLS admin_scanner role. NOT
 * wrapped with the tenant-GUC transaction hook — it deliberately bypasses
 * RLS for the one read-only cross-tenant scan it exists for. NEVER use this
 * client for writes, and never use it for anything other than
 * list_sftp_lead_source_tenants().
 */
export const scannerSqlClient = createSqlClient(scannerUrl);
