/**
 * Cross-tenant maintenance scanner DB pool (BYPASSRLS) — mirrors
 * works-service / payroll-service / visitor-service src/shared/scanner-db.ts.
 *
 * worker.ts's outbox relay (startRelay) and scheduled outbox purge
 * (startOutboxPurge) must scan _outbox.messages / _inbox.processed ACROSS ALL
 * TENANTS to find unpublished/expired rows. Under the least-privilege
 * inspection_svc role (NOBYPASSRLS) with FORCE ROW LEVEL SECURITY on
 * _outbox.messages (migration 0023_outbox_inbox_rls.sql), a bare cross-tenant
 * SELECT with no app.tenant_id GUC set returns ZERO rows — the relay/purge
 * would silently no-op in production.
 *
 * This module wires a SECOND pool that authenticates as the dedicated
 * `inspection_scanner` BYPASSRLS role (migration 0022_inspection_scanner_role.sql).
 * It is used for the outbox/inbox maintenance loops ONLY — never for the
 * tenant-scoped business tables under inspection module schemas.
 *
 * INSPECTION_SCANNER_DATABASE_URL selects the scanner DSN; falls back to
 * DATABASE_URL (safe in dev). In production, INSPECTION_SCANNER_DATABASE_URL
 * MUST point at the inspection_scanner role.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { outboxSchema } from "./outbox.js";

const scannerUrl = process.env.INSPECTION_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!scannerUrl) {
  throw new Error(
    "INSPECTION_SCANNER_DATABASE_URL or DATABASE_URL is required for the cross-tenant scanner pool",
  );
}

/** Dedicated postgres-js client for the BYPASSRLS scanner role. */
export const scannerSqlClient = createSqlClient(scannerUrl);

/**
 * Plain Drizzle handle over the scanner pool, wired ONLY with the outbox/inbox
 * schema. NOT wrapped with the tenant-GUC transaction hook — deliberately
 * bypasses RLS for the cross-tenant outbox relay/purge. NEVER use for
 * tenant-scoped business tables.
 */
export const scannerDb = drizzle(scannerSqlClient, { schema: outboxSchema });
