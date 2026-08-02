/**
 * Cross-tenant maintenance scanner DB pool (BYPASSRLS) — mirrors
 * payroll-service/asset-service src/shared/scanner-db.ts.
 *
 * worker.ts's outbox relay (startRelay) and scheduled outbox purge
 * (startOutboxPurge) must scan _outbox.messages / _inbox.processed ACROSS ALL
 * TENANTS. Under the least-privilege finance_svc role (NOBYPASSRLS) with
 * FORCE ROW LEVEL SECURITY on tenant tables, a bare cross-tenant SELECT with
 * no app.tenant_id GUC set returns ZERO rows — the relay/purge would silently
 * no-op when outbox RLS is enforced.
 *
 * This module wires a SECOND pool that authenticates as the dedicated
 * `finance_scanner` BYPASSRLS role (migration 0052_finance_scanner_role.sql).
 * It is used for the outbox/inbox maintenance loops ONLY — never for the
 * tenant-scoped business tables under finance schemas.
 *
 * FINANCE_SCANNER_DATABASE_URL selects the scanner DSN; falls back to
 * DATABASE_URL (safe in dev). In production, FINANCE_SCANNER_DATABASE_URL
 * MUST point at the finance_scanner role.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { outboxSchema } from "./outbox.js";

const scannerUrl = process.env.FINANCE_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!scannerUrl) {
  throw new Error(
    "FINANCE_SCANNER_DATABASE_URL or DATABASE_URL is required for the cross-tenant scanner pool",
  );
}

/** Dedicated postgres-js client for the BYPASSRLS scanner role. */
export const scannerSqlClient = createSqlClient(scannerUrl);

/**
 * Plain Drizzle handle over the scanner pool, wired ONLY with the outbox/inbox
 * schema. NOT wrapped with the tenant-GUC transaction hook — deliberately
 * bypasses RLS for cross-tenant outbox relay/purge. NEVER use for tenant-scoped
 * business writes.
 */
export const scannerDb = drizzle(scannerSqlClient, { schema: outboxSchema });
