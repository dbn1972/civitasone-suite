/**
 * Scheduled worker task: DPDP data-retention PII purge.
 *
 * Runs once daily (configurable) and purges PII fields from visit_requests
 * whose last activity (check-out timestamp or, if never checked out, created_at)
 * is older than the configured retention period (default 365 days).
 *
 * Purged PII columns: visitorName, visitorPhone, visitorEmail, identityDocRef.
 * The anonymized row is retained for statistical reporting (visit count, duration,
 * status, purpose category, timestamps minus PII).
 *
 * Follows the `startVisitRequestAutoReject` pattern: setInterval with an async
 * IIFE, swallows errors to avoid crashing the worker process, logs warnings on
 * failures, and returns the interval handle for graceful shutdown cleanup.
 *
 * Requirement 18.3: "THE Visitor_Service SHALL automatically purge visitor
 * personal data after the configured retention period (default 365 days from
 * last visit), retaining only anonymized statistical records."
 */
import { and, sql } from "drizzle-orm";
import { visitRequests } from "../visit-request/schema.js";
import type { Db } from "../../shared/db.js";

/** Sentinel value written to encrypted PII columns to indicate purged state. */
export const PURGED_SENTINEL = "[PURGED]";

export interface PurgeWorkerOptions {
  /** Interval between purge runs in milliseconds. Default: 24 hours. */
  intervalMs?: number;
  /** Retention period in milliseconds. Default: 365 days. */
  retentionPeriodMs?: number;
  /** Maximum number of records to purge per cycle (batch size). Default: 500. */
  batchSize?: number;
  /** Pino-compatible logger. */
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void };
}

/**
 * Start the periodic data-retention PII purge worker.
 * Returns the interval handle so the caller can `clearInterval` on shutdown.
 */
export function startDataRetentionPurge(
  db: Db,
  opts: PurgeWorkerOptions = {},
): NodeJS.Timeout {
  const {
    intervalMs = 24 * 60 * 60_000, // daily
    logger,
  } = opts;

  const timer = setInterval(() => {
    void (async () => {
      try {
        await processPurgeCycle(db, opts);
      } catch (err) {
        logger?.warn(
          { err, event: "dpdp_purge_cycle_failed" },
          "DPDP data-retention purge cycle failed",
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
 * Determines "last activity" for a visit request as the most recent check-out
 * timestamp (direction = 'out') from any check-in record associated via
 * digital_passes. If no check-out exists, falls back to the visit request's
 * `createdAt` timestamp.
 *
 * Only purges rows where PII has not already been purged (visitorName != PURGED_SENTINEL).
 */
export async function processPurgeCycle(
  db: Db,
  opts: PurgeWorkerOptions = {},
): Promise<{ purgedCount: number }> {
  const {
    retentionPeriodMs = 365 * 24 * 60 * 60_000,
    batchSize = 500,
    logger,
  } = opts;

  const cutoffDate = new Date(Date.now() - retentionPeriodMs);

  // Find visit_requests eligible for purge:
  // - Last activity (latest check-out or created_at) is older than the retention cutoff
  // - PII has not already been purged (visitorName != PURGED_SENTINEL)
  //
  // Strategy: use a subquery to find the latest check-out timestamp per visit request.
  // If no check-out exists, the visit request's created_at is used as last activity.
  const eligibleRequests = await db
    .select({
      id: visitRequests.id,
    })
    .from(visitRequests)
    .where(
      and(
        // Not already purged
        sql`${visitRequests.visitorName} != ${PURGED_SENTINEL}`,
        // Last activity is older than retention cutoff:
        // COALESCE(latest check-out timestamp, created_at) < cutoff
        sql`COALESCE(
          (
            SELECT MAX(ci."timestamp")
            FROM visitor.check_ins ci
            INNER JOIN visitor.digital_passes dp ON dp.id = ci.pass_id
            WHERE dp.visit_request_id = ${visitRequests.id}
              AND ci.direction = 'out'
          ),
          ${visitRequests.createdAt}
        ) < ${cutoffDate}`,
      ),
    )
    .limit(batchSize);

  if (eligibleRequests.length === 0) {
    return { purgedCount: 0 };
  }

  const ids = eligibleRequests.map((r) => r.id);

  // Null out PII columns, replacing with the purged sentinel
  const result = await db
    .update(visitRequests)
    .set({
      visitorName: PURGED_SENTINEL,
      visitorPhone: PURGED_SENTINEL,
      visitorEmail: null,
      identityDocRef: null,
      photoRef: null,
      updatedAt: new Date(),
      updatedBy: "00000000-0000-0000-0000-000000000000", // system actor
    })
    .where(sql`${visitRequests.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);

  logger?.info(
    { purgedCount: ids.length, event: "dpdp_purge_cycle_complete" },
    `DPDP purge cycle: ${ids.length} visit records purged of PII`,
  );

  return { purgedCount: ids.length };
}
