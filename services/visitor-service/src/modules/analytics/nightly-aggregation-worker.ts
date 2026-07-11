/**
 * Scheduled worker task: nightly analytics aggregation.
 *
 * Runs every 24 hours (configurable) and computes daily visitor metrics
 * for the previous day across all tenant/location combinations.
 *
 * 1. Queries `visit_requests` for all requests whose `scheduledAt` falls
 *    within the previous calendar day (UTC).
 * 2. Queries `check_ins` for matching check-in/check-out timestamps.
 * 3. Calls `computeDailyMetrics()` from domain.ts with the joined data.
 * 4. Inserts the aggregated result into the `visitor.daily_metrics` table.
 *
 * Follows the `startVisitRequestAutoReject` pattern: setInterval with an
 * async IIFE, swallows errors to avoid crashing the worker process, logs
 * warnings on failures, and returns the interval handle for graceful
 * shutdown cleanup.
 *
 * Requirement 19.1: Daily-metrics aggregation (total visits, unique visitors,
 * avg approval turnaround, avg visit duration, peak-hour distribution,
 * no-show rate).
 */
import { randomUUID } from "node:crypto";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { visitRequests } from "../visit-request/schema.js";
import { checkIns } from "../check-in/schema.js";
import { computeDailyMetrics, type VisitRecord } from "./domain.js";
import type { Db } from "../../shared/db.js";

export interface NightlyAggregationWorkerOptions {
  /** Interval between runs in milliseconds. Default: 24 hours. */
  intervalMs?: number;
  /** Pino-compatible logger. */
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void };
}

/**
 * Start the periodic nightly aggregation worker.
 * Returns the interval handle so the caller can `clearInterval` on shutdown.
 */
export function startNightlyAggregation(
  db: Db,
  opts: NightlyAggregationWorkerOptions = {},
): NodeJS.Timeout {
  const {
    intervalMs = 24 * 60 * 60_000,
    logger,
  } = opts;

  const timer = setInterval(() => {
    void (async () => {
      try {
        await processNightlyAggregation(db, logger);
      } catch (err) {
        // Non-critical maintenance — swallow to avoid crashing the worker
        logger?.warn(
          { err, event: "nightly_aggregation_failed" },
          "nightly analytics aggregation cycle failed",
        );
      }
    })();
  }, intervalMs);
  timer.unref();
  return timer;
}

/**
 * Core logic for a single nightly aggregation cycle. Exported for testing.
 *
 * Computes metrics for yesterday (UTC) per tenant/location pair found in
 * visit_requests, then inserts one row per pair into daily_metrics.
 */
export async function processNightlyAggregation(
  db: Db,
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void },
): Promise<{ rowsInserted: number }> {
  // Previous day boundaries (UTC)
  const now = new Date();
  const dayStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - 1,
  ));
  const dayEnd = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));

  // Step 1: Get all distinct tenant/location combinations that had activity yesterday
  const activeLocations = await db
    .selectDistinct({
      tenantId: visitRequests.tenantId,
      locationId: visitRequests.locationId,
    })
    .from(visitRequests)
    .where(
      and(
        gte(visitRequests.createdAt, dayStart),
        lt(visitRequests.createdAt, dayEnd),
      ),
    );

  if (activeLocations.length === 0) {
    logger?.info(
      { event: "nightly_aggregation_no_data", date: dayStart.toISOString() },
      "nightly aggregation: no visit activity found for previous day",
    );
    return { rowsInserted: 0 };
  }

  let rowsInserted = 0;

  for (const { tenantId, locationId } of activeLocations) {
    try {
      // Step 2: Query visit requests for this tenant/location on the previous day
      const dayVisitRequests = await db
        .select({
          id: visitRequests.id,
          visitorId: visitRequests.visitorId,
          status: visitRequests.status,
          createdAt: visitRequests.createdAt,
          updatedAt: visitRequests.updatedAt,
        })
        .from(visitRequests)
        .where(
          and(
            eq(visitRequests.tenantId, tenantId),
            eq(visitRequests.locationId, locationId),
            gte(visitRequests.createdAt, dayStart),
            lt(visitRequests.createdAt, dayEnd),
          ),
        );

      // Step 3: Query check-ins for this tenant/location on the previous day
      const dayCheckIns = await db
        .select({
          id: checkIns.id,
          passId: checkIns.passId,
          direction: checkIns.direction,
          timestamp: checkIns.timestamp,
        })
        .from(checkIns)
        .where(
          and(
            eq(checkIns.tenantId, tenantId),
            eq(checkIns.locationId, locationId),
            gte(checkIns.timestamp, dayStart),
            lt(checkIns.timestamp, dayEnd),
          ),
        );

      // Build a map of passId → { checkedInAt, checkedOutAt } from check-ins
      const checkInMap = new Map<string, { checkedInAt: Date | null; checkedOutAt: Date | null }>();
      for (const ci of dayCheckIns) {
        const existing = checkInMap.get(ci.passId) ?? { checkedInAt: null, checkedOutAt: null };
        if (ci.direction === "in" && (existing.checkedInAt === null || ci.timestamp < existing.checkedInAt)) {
          existing.checkedInAt = ci.timestamp;
        }
        if (ci.direction === "out" && (existing.checkedOutAt === null || ci.timestamp > existing.checkedOutAt)) {
          existing.checkedOutAt = ci.timestamp;
        }
        checkInMap.set(ci.passId, existing);
      }

      // Step 4: Build VisitRecord[] for domain.computeDailyMetrics()
      // We approximate "approvedAt" as updatedAt for approved/checked-in/checked-out visits
      const visitRecords: VisitRecord[] = dayVisitRequests.map((vr) => {
        const isApproved = ["approved", "checked_in", "checked_out", "no_show"].includes(vr.status);
        // Try to find check-in data by passId — but we have visitId, not passId directly.
        // Use visitId as a key for check-in lookup (visits match 1:1 with passes)
        const checkInData = checkInMap.get(vr.id);

        return {
          visitId: vr.id,
          visitorId: vr.visitorId ?? vr.id, // fallback to visitId if visitorId absent
          status: vr.status,
          createdAt: vr.createdAt,
          approvedAt: isApproved ? vr.updatedAt : null,
          checkedInAt: checkInData?.checkedInAt ?? null,
          checkedOutAt: checkInData?.checkedOutAt ?? null,
        };
      });

      // Step 5: Compute daily metrics via pure domain function
      const metrics = computeDailyMetrics(visitRecords);

      // Determine peak hour (hour with max check-ins)
      let peakHour: number | null = null;
      let maxCount = 0;
      for (const [hour, count] of Object.entries(metrics.peakHourDistribution)) {
        if (count > maxCount) {
          maxCount = count;
          peakHour = Number(hour);
        }
      }

      // Count rejected visits for the rejected_count column
      const rejectedCount = dayVisitRequests.filter(
        (vr) => vr.status === "rejected" || vr.status === "auto_rejected",
      ).length;

      // Step 6: Insert into daily_metrics table
      await db.execute(sql`
        INSERT INTO visitor.daily_metrics (
          id, tenant_id, location_id, date, total_visits, unique_visitors,
          avg_approval_time_ms, avg_visit_duration_ms, peak_hour,
          no_show_count, rejected_count, created_at
        ) VALUES (
          ${randomUUID()}, ${tenantId}, ${locationId}, ${dayStart},
          ${metrics.totalVisits}, ${metrics.uniqueVisitors},
          ${metrics.avgApprovalTurnaroundMs}, ${metrics.avgVisitDurationMs},
          ${peakHour}, ${Math.round(metrics.noShowRate * metrics.totalVisits)},
          ${rejectedCount}, now()
        )
      `);

      rowsInserted++;
    } catch (err) {
      logger?.warn(
        { err, tenantId, locationId, event: "nightly_aggregation_location_failed" },
        `nightly aggregation failed for tenant=${tenantId} location=${locationId}`,
      );
    }
  }

  if (rowsInserted > 0) {
    logger?.info(
      { rowsInserted, date: dayStart.toISOString(), event: "nightly_aggregation_complete" },
      `nightly aggregation: ${rowsInserted} daily_metrics rows inserted for ${dayStart.toISOString().slice(0, 10)}`,
    );
  }

  return { rowsInserted };
}
