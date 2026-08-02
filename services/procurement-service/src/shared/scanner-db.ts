/**
 * Cross-tenant maintenance scanner DB pool (BYPASSRLS) — mirrors
 * court-service/visitor-service's src/shared/scanner-db.ts.
 *
 * worker.ts's outbox relay (startRelay) and scheduled outbox purge
 * (startOutboxPurge) must scan _outbox.messages / _inbox.processed ACROSS ALL
 * TENANTS to find unpublished/expired rows. Under the least-privilege
 * procurement_svc role (NOBYPASSRLS) with FORCE ROW LEVEL SECURITY on those
 * tables (migration 0028_outbox_inbox_rls.sql), a bare cross-tenant SELECT
 * with no app.tenant_id GUC set returns ZERO rows — the relay/purge would
 * silently no-op in production.
 *
 * This module wires a SECOND pool that authenticates as the dedicated
 * `procurement_scanner` BYPASSRLS role (migration
 * 0027_procurement_scanner_role.sql). It is used for the outbox/inbox
 * maintenance loops ONLY — never for the tenant-scoped business tables under
 * `vendor.*` / `tender.*` / `po.*` / etc.
 *
 * PROCUREMENT_SCANNER_DATABASE_URL selects the scanner DSN; falls back to
 * DATABASE_URL (safe in dev, where the service connects as the RLS-inert
 * superuser). In production/CI running as the real NOBYPASSRLS
 * procurement_svc role, PROCUREMENT_SCANNER_DATABASE_URL MUST point at the
 * procurement_scanner role for the relay/purge to see other tenants' outbox
 * rows.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { outboxSchema } from "./outbox.js";

const scannerUrl = process.env.PROCUREMENT_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!scannerUrl) {
  throw new Error(
    "PROCUREMENT_SCANNER_DATABASE_URL or DATABASE_URL is required for the cross-tenant scanner pool",
  );
}

/** Dedicated postgres-js client for the BYPASSRLS scanner role. */
export const scannerSqlClient = createSqlClient(scannerUrl);

/**
 * Plain Drizzle handle over the scanner pool, wired ONLY with the outbox/inbox
 * schema (the only tables this role is granted against). NOT wrapped with the
 * tenant-GUC transaction hook — it deliberately bypasses RLS for the
 * cross-tenant outbox relay/purge. NEVER use this handle for the tenant-scoped
 * business tables or for writes outside the outbox/inbox maintenance loops.
 */
export const scannerDb = drizzle(scannerSqlClient, { schema: outboxSchema });
