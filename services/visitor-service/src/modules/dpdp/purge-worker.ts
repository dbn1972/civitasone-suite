/**
 * Scheduled worker task: DPDP data-retention + right-to-erasure PII purge.
 *
 * Runs once daily (configurable) and purges PII fields from visit_requests in
 * two cases:
 *
 * 1. Retention expiry (Requirement 18.3): last activity (latest check-out, else
 *    created_at) is older than the retention period (default 365 days).
 * 2. Right to erasure (Requirement 18.4): the row carries an `erasure_requested_at`
 *    timestamp older than the erasure SLA (default 72h). dpdp/routes.ts sets
 *    erasure_requested_at when a data-subject requests erasure and PROMISES purge
 *    within 72h — before this worker it was a no-op because the retention pass
 *    only looked at the 365-day cutoff and never read erasure_requested_at.
 *
 * CROSS-TENANT under RLS: the eligibility scan spans ALL tenants, so it reads
 * through the BYPASSRLS `scannerDb` pool (shared/scanner-db.ts). Every WRITE runs
 * on the primary `db` inside `runWithTenant(tenantId, ...)` so the purge UPDATE is
 * RLS-checked and tenant-scoped. Under the least-privilege visitor_svc role the
 * old single-pool `db.select()` scan returned ZERO rows, so the purge silently did
 * nothing in production.
 *
 * Purged PII columns: visitorName, visitorPhone, visitorEmail, identityDocRef,
 * photoRef. The anonymized row is retained for statistical reporting.
 */
import { and, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { visitRequests } from "../visit-request/schema.js";
import type { Db } from "../../shared/db.js";

/** Sentinel value written to PII columns to indicate purged state. */
export const PURGED_SENTINEL = "[PURGED]";

/** System actor UUID used for the purge UPDATE audit columns. */
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

export interface PurgeWorkerOptions {
  /** Interval between purge runs in milliseconds. Default: 24 hours. */
  intervalMs?: number;
  /** Retention period in milliseconds. Default: 365 days. */
  retentionPeriodMs?: number;
  /** Right-to-erasure SLA in milliseconds. Default: 72 hours. */
  erasureSlaMs?: number;
  /** Maximum number of records to purge per cycle (batch size). Default: 500. */
  batchSize?: number;
  /** Pino-compatible logger. */
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void };
}

/**
 * Start the periodic data-retention + erasure PII purge worker.
 *
 * @param db        primary (visitor_svc) pool — writes run here inside runWithTenant.
 * @param scannerDb BYPASSRLS pool — cross-tenant eligibility scan only.
 */
export function startDataRetentionPurge(
  db: Db,
  scannerDb: Db,
  opts: PurgeWorkerOptions = {},
): NodeJS.Timeout {
  const { intervalMs = 24 * 60 * 60_000, logger } = opts;

  const timer = setInterval(() => {
    void (async () => {
      try {
        await processPurgeCycle(db, scannerDb, opts);
      } catch (err) {
        logger?.warn(
          { err, event: "dpdp_purge_cycle_failed" },
          "DPDP data-retention/erasure purge cycle failed",
        );
      }
    })();
  }, intervalMs);
  timer.unref();
  return timer;
}

/**
 * Core logic for a single purge cycle. Exported for testing.
 *
 * A row is eligible when its PII has not already been purged AND either:
 *   - COALESCE(latest check-out, created_at) < retention cutoff, OR
 *   - erasure_requested_at IS NOT NULL AND erasure_requested_at < erasure cutoff.
 *
 * The scan (scannerDb) is cross-tenant; writes are grouped per tenant and applied
 * inside runWithTenant(tenantId, ...) on the primary db so RLS scopes each UPDATE.
 */
export async function processPurgeCycle(
  db: Db,
  scannerDb: Db,
  opts: PurgeWorkerOptions = {},
): Promise<{ purgedCount: number; purgedByTenant: Record<string, number> }> {
  const {
    retentionPeriodMs = 365 * 24 * 60 * 60_000,
    erasureSlaMs = 72 * 60 * 60_000,
    batchSize = 500,
    logger,
  } = opts;

  const now = Date.now();
  const retentionCutoff = new Date(now - retentionPeriodMs).toISOString();
  const erasureCutoff = new Date(now - erasureSlaMs).toISOString();

  // Cross-tenant eligibility scan via the BYPASSRLS scanner pool.
  const eligible = await scannerDb
    .select({
      id: visitRequests.id,
      tenantId: visitRequests.tenantId,
    })
    .from(visitRequests)
    .where(
      and(
        sql`${visitRequests.visitorName} != ${PURGED_SENTINEL}`,
        sql`(
          COALESCE(
            (
              SELECT MAX(ci."timestamp")
              FROM visitor.check_ins ci
              INNER JOIN visitor.digital_passes dp ON dp.id = ci.pass_id
              WHERE dp.visit_request_id = ${visitRequests.id}
                AND ci.direction = 'out'
            ),
            ${visitRequests.createdAt}
          ) < ${retentionCutoff}
          OR (
            ${visitRequests.erasureRequestedAt} IS NOT NULL
            AND ${visitRequests.erasureRequestedAt} < ${erasureCutoff}
          )
        )`,
      ),
    )
    .limit(batchSize);

  if (eligible.length === 0) {
    return { purgedCount: 0, purgedByTenant: {} };
  }

  // Group eligible ids by tenant so each tenant's purge runs in its own scope.
  const idsByTenant = new Map<string, string[]>();
  for (const row of eligible) {
    const list = idsByTenant.get(row.tenantId) ?? [];
    list.push(row.id);
    idsByTenant.set(row.tenantId, list);
  }

  const purgedByTenant: Record<string, number> = {};
  let purgedCount = 0;

  for (const [tenantId, ids] of idsByTenant) {
    try {
      await runWithTenant(tenantId, () =>
        db.transaction(async (tx) => {
          await tx
            .update(visitRequests)
            .set({
              visitorName: PURGED_SENTINEL,
              visitorPhone: PURGED_SENTINEL,
              visitorEmail: null,
              identityDocRef: null,
              photoRef: null,
              updatedAt: new Date(),
              updatedBy: SYSTEM_ACTOR,
            })
            .where(
              and(
                sql`${visitRequests.tenantId} = ${tenantId}`,
                sql`${visitRequests.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`,
              ),
            );
        }),
      );
      purgedByTenant[tenantId] = ids.length;
      purgedCount += ids.length;
    } catch (err) {
      logger?.warn(
        { err, tenantId, event: "dpdp_purge_tenant_failed" },
        `DPDP purge failed for tenant=${tenantId}`,
      );
    }
  }

  logger?.info(
    { purgedCount, purgedByTenant, event: "dpdp_purge_cycle_complete" },
    `DPDP purge cycle: ${purgedCount} visit records purged of PII across ${Object.keys(purgedByTenant).length} tenant(s)`,
  );

  return { purgedCount, purgedByTenant };
}
