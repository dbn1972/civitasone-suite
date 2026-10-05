/**
 * Cross-tenant READ-ONLY discovery pool for the bulk-scan dispatcher / lease sweeper.
 *
 * bulk_scan.* is FORCE ROW LEVEL SECURITY and the service connects as the NOBYPASSRLS role document_svc, so a
 * cross-tenant "which tenants have due work" query would see zero rows. This pool authenticates as the
 * dedicated `document_scanner` BYPASSRLS role (migration 0007_bulk_scan_scanner_role.sql), which is granted
 * SELECT on bulk_scan.batch_files ONLY. Every write still happens through document_svc inside the tenant GUC.
 *
 * DOCUMENT_SCANNER_DATABASE_URL selects the scanner DSN. It falls back to DATABASE_URL ONLY when NODE_ENV is development
 * or test (see scanner-url.ts); anywhere else (including an unset NODE_ENV) a missing / service-role DSN fails fast at
 * worker start, because the dispatcher would otherwise find no work and nothing would be processed.
 *
 * NEVER use this handle for writes or for any table other than bulk_scan.batch_files.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as bulkScanModule } from "../modules/bulk-scan/schema.js";
import { resolveScannerUrl } from "./scanner-url.js";

const scannerUrl = resolveScannerUrl(process.env);

export const scannerSqlClient = createSqlClient(scannerUrl);
export const scannerDb = drizzle(scannerSqlClient, { schema: bulkScanModule });
