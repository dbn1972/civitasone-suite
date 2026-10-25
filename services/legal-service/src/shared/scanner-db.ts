/**
 * Cross-tenant discovery pool (BYPASSRLS legal_scanner role) -- CLOS3-S5-07.
 *
 * The e-Courts cause-list sync tick must discover tracked matters across ALL
 * tenants. ecourts.cause_list_syncs is FORCE ROW LEVEL SECURITY, and under the
 * least-privilege legal_svc role a read with no app.tenant_id GUC errors or
 * returns nothing, so the sync silently never ran.
 *
 * Mirrors asset-service/shared/scanner-db.ts: a SECOND pool authenticating as
 * the SELECT-only legal_scanner role (migration 0028), used for the discovery
 * SELECT ONLY. Every write that follows runs under
 * runWithTenant(row.tenantId, ...) on the normal pool, so RLS re-checks it.
 *
 * LEGAL_SCANNER_DATABASE_URL selects the scanner DSN. When unset it falls back
 * to DATABASE_URL (dev, where the connection role is RLS-inert). In production
 * it MUST be set and distinct (enforced in worker.ts).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";

const scannerUrl = process.env.LEGAL_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!scannerUrl) {
  throw new Error("LEGAL_SCANNER_DATABASE_URL or DATABASE_URL is required for the cross-tenant scanner pool");
}

/** Dedicated postgres-js client for the BYPASSRLS scanner role. */
export const scannerSqlClient = createSqlClient(scannerUrl);

/** Plain Drizzle handle over the scanner pool. READ-ONLY discovery; NEVER write through it. */
export const scannerDb = drizzle(scannerSqlClient);
