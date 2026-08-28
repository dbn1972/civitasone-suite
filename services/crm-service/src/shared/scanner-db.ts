/**
 * Cross-tenant maintenance scanner DB client (BYPASSRLS) — mirrors
 * finance-service / visitor-service / payroll-service src/shared/scanner-db.ts.
 *
 * crm.list_document_alert_tenants() (migrations/0089_crm_scanner_role.sql)
 * discovers which tenants have document-alert-relevant rows ACROSS ALL
 * TENANTS, ahead of the per-tenant, RLS-scoped runTenantDocumentAlerts()
 * pass. Under the least-privilege crm_svc role (NOBYPASSRLS) with FORCE ROW
 * LEVEL SECURITY on crm.document_types / crm.documents, that discovery query
 * gains nothing from being wrapped in a SECURITY DEFINER function whose
 * owner (civitas_admin) is ALSO NOBYPASSRLS — it returns ZERO rows and
 * runDocumentAlertCycle() silently never fires for any tenant. See
 * 0089_crm_scanner_role.sql for the full analysis.
 *
 * This module wires a SECOND connection that authenticates as the dedicated
 * `crm_scanner` BYPASSRLS role. Use it for tenant-discovery ONLY — never for
 * tenant-scoped business reads/writes, which stay on the default
 * `sqlClient`/`db` (crm_svc, normal RLS) exactly as before.
 *
 * CRM_SCANNER_DATABASE_URL selects the scanner DSN; falls back to
 * DATABASE_URL (safe in dev, where crm_svc and crm_scanner point at the same
 * local Postgres). In production, CRM_SCANNER_DATABASE_URL MUST point at the
 * crm_scanner role.
 */
import { createSqlClient } from "@civitasone/db";

const scannerUrl = process.env.CRM_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!scannerUrl) {
  throw new Error(
    "CRM_SCANNER_DATABASE_URL or DATABASE_URL is required for the cross-tenant scanner pool",
  );
}

/** Dedicated postgres-js client for the BYPASSRLS crm_scanner role. */
export const scannerSqlClient = createSqlClient(scannerUrl);
