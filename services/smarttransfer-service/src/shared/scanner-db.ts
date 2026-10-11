/**
 * Cross-tenant maintenance scanner DB pool (BYPASSRLS) — mirrors
 * court-service/src/shared/scanner-db.ts.
 *
 * The outbox relay and the scheduled purge (outbox, inbox, command_results)
 * scan ACROSS ALL TENANTS. _outbox.messages and _inbox.command_results are
 * FORCE RLS (0001; D-20), so under the NOBYPASSRLS smarttransfer_svc role a
 * query with no app.tenant_id GUC returns zero rows. This pool authenticates as
 * the dedicated smarttransfer_scanner role (0002_smarttransfer_scanner_role.sql)
 * and is used by worker.ts for those two loops ONLY — never for the
 * smarttransfer.* business tables.
 *
 * SMARTTRANSFER_SCANNER_DATABASE_URL selects the scanner DSN; it falls back to
 * DATABASE_URL outside production only (worker.ts fails closed in production).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { outboxSchema } from "./outbox.js";

const scannerUrl = process.env.SMARTTRANSFER_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!scannerUrl) {
  throw new Error(
    "SMARTTRANSFER_SCANNER_DATABASE_URL or DATABASE_URL is required for the cross-tenant scanner pool",
  );
}

export const scannerSqlClient = createSqlClient(scannerUrl);

/** Plain Drizzle handle (no tenant-GUC hook) wired only with the outbox/inbox schema. */
export const scannerDb = drizzle(scannerSqlClient, { schema: outboxSchema });
