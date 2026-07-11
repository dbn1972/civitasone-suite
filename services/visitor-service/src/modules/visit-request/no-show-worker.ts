/**
 * Scheduled worker task: no-show detection.
 *
 * Runs every 15 minutes (configurable) and performs two checks:
 *
 * 1. **30-minute warning** (Requirement 16.3): finds approved visit requests
 *    whose `scheduledAt` is more than 30 minutes in the past with no
 *    associated check-in, and publishes a NOTIFICATION_SEND warning to the
 *    host employee (push channel).
 *
 * 2. **2-hour auto no-show** (Requirement 16.4): finds approved visit requests
 *    whose `scheduledAt` is more than 2 hours in the past with no associated
 *    check-in, transitions them to 'no_show' status, releases any allocated
 *    parking slot (publishes COMMANDS.parkingSlotRelease if a vehicle pass
 *    exists), and outboxes a noShowDetected event.
 *
 * Follows the `startVisitRequestAutoReject` pattern: setInterval with an async
 * IIFE, swallows errors to avoid crashing the worker process, logs warnings on
 * failures, and returns the interval handle for graceful shutdown cleanup.
 */
import { randomUUID } from "node:crypto";
import { and, eq, lt, isNotNull, inArray } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { COMMANDS, EVENTS } from "../../topics.js";
import { visitRequests } from "./schema.js";
import { digitalPasses } from "../digital-pass/schema.js";
import { vehiclePasses } from "../vehicle-pass/schema.js";
import { checkIns } from "../check-in/schema.js";
import type { Db } from "../../shared/db.js";

export interface NoShowWorkerOptions {
  /** Interval between checks in milliseconds. Default: 15 minutes. */
  intervalMs?: number;
  /** Threshold for sending a no-show warning to host. Default: 30 minutes. */
  warningThresholdMs?: number;
  /** Threshold for auto-transitioning to no_show. Default: 2 hours. */
  noShowThresholdMs?: number;
  /** Pino-compatible logger. */
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void };
}

/**
 * Start the periodic no-show detection worker.
 * Returns the interval handle so the caller can `clearInterval` on shutdown.
 */
export function startNoShowDetection(
  db: Db,
  queue: Queue,
  opts: NoShowWorkerOptions = {},
): NodeJS.Timeout {
  const {
    intervalMs = 15 * 60_000,
    warningThresholdMs = 30 * 60_000,
    noShowThresholdMs = 2 * 60 * 60_000,
    logger,
  } = opts;

  const timer = setInterval(() => {
    void (async () => {
      try {
        await processNoShowCycle(db, queue, warningThresholdMs, noShowThresholdMs, logger);
      } catch (err) {
        // Non-critical maintenance — swallow to avoid crashing the worker
        logger?.warn(
          { err, event: "no_show_cycle_failed" },
          "no-show detection cycle failed",
        );
      }
    })();
  }, intervalMs);
  timer.unref();
  return timer;
}

/**
 * Core logic for a single no-show detection cycle. Exported for testing.
 */
export async function processNoShowCycle(
  db: Db,
  queue: Queue,
  warningThresholdMs: number,
  noShowThresholdMs: number,
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void },
): Promise<{ warnings: number; noShows: number }> {
  const now = new Date();
  const warningCutoff = new Date(now.getTime() - warningThresholdMs);
  const noShowCutoff = new Date(now.getTime() - noShowThresholdMs);

  // ── Step 1: Find visit request IDs that have a check-in (exclude) ────
  // A check-in is linked to a visit request through the digital pass.
  // Get all pass IDs that have at least one check-in (direction='in').
  const checkedInPassRows = await db
    .selectDistinct({ passId: checkIns.passId })
    .from(checkIns)
    .where(eq(checkIns.direction, "in"));
  const checkedInPassIds = checkedInPassRows.map((r) => r.passId);

  // Map checked-in pass IDs to their visit request IDs
  let visitReqIdsWithCheckIn: string[] = [];
  if (checkedInPassIds.length > 0) {
    const passToVisitRows = await db
      .selectDistinct({ visitRequestId: digitalPasses.visitRequestId })
      .from(digitalPasses)
      .where(inArray(digitalPasses.id, checkedInPassIds));
    visitReqIdsWithCheckIn = passToVisitRows.map((r) => r.visitRequestId);
  }
  const visitReqsWithCheckInSet = new Set(visitReqIdsWithCheckIn);

  // ── Step 2: Auto no-show for requests older than 2h ──────────────────
  // Query approved visit requests with scheduledAt before the no-show cutoff
  const noShowCandidates = await db
    .select({
      id: visitRequests.id,
      tenantId: visitRequests.tenantId,
      hostEmployeeId: visitRequests.hostEmployeeId,
      visitorName: visitRequests.visitorName,
      scheduledAt: visitRequests.scheduledAt,
      locationId: visitRequests.locationId,
      version: visitRequests.version,
    })
    .from(visitRequests)
    .where(
      and(
        eq(visitRequests.status, "approved"),
        isNotNull(visitRequests.scheduledAt),
        lt(visitRequests.scheduledAt, noShowCutoff),
      ),
    );

  let noShows = 0;
  const noShowIds = new Set<string>();

  for (const req of noShowCandidates) {
    // Skip if a check-in already exists for this visit request
    if (visitReqsWithCheckInSet.has(req.id)) continue;

    try {
      // Transition to no_show status
      await db
        .update(visitRequests)
        .set({
          status: "no_show",
          updatedAt: now,
          updatedBy: "00000000-0000-0000-0000-000000000000", // system
          version: req.version + 1,
        })
        .where(
          and(
            eq(visitRequests.id, req.id),
            eq(visitRequests.version, req.version),
          ),
        );

      // Release parking slot if vehicle pass exists
      const vehiclePassRows = await db
        .select({
          id: vehiclePasses.id,
          parkingSlotId: vehiclePasses.parkingSlotId,
        })
        .from(vehiclePasses)
        .innerJoin(digitalPasses, eq(digitalPasses.id, vehiclePasses.passId))
        .where(
          and(
            eq(digitalPasses.visitRequestId, req.id),
            isNotNull(vehiclePasses.parkingSlotId),
          ),
        );

      for (const vp of vehiclePassRows) {
        if (vp.parkingSlotId) {
          await queue.publish(COMMANDS.parkingSlotRelease, {
            type: COMMANDS.parkingSlotRelease,
            tenantId: req.tenantId,
            actorId: "system",
            correlationId: randomUUID(),
            schemaVersion: "1.0",
            payload: {
              vehiclePassId: vp.id,
              parkingSlotId: vp.parkingSlotId,
              reason: "no_show",
            },
          });
        }
      }

      // Outbox: noShowDetected event
      await queue.publish(EVENTS.noShowDetected, {
        type: EVENTS.noShowDetected,
        tenantId: req.tenantId,
        actorId: "system",
        correlationId: randomUUID(),
        schemaVersion: "1.0",
        payload: {
          id: req.id,
          tenantId: req.tenantId,
          hostEmployeeId: req.hostEmployeeId,
          locationId: req.locationId,
          scheduledAt: req.scheduledAt?.toISOString() ?? "",
          detectedAt: now.toISOString(),
        },
      });

      noShows++;
      noShowIds.add(req.id);
    } catch (err) {
      logger?.warn(
        { err, visitRequestId: req.id, tenantId: req.tenantId, event: "no_show_transition_failed" },
        "failed to transition visit request to no_show",
      );
    }
  }

  // ── Step 3: Warning for requests 30m+ past scheduled but not yet 2h ──
  const warningCandidates = await db
    .select({
      id: visitRequests.id,
      tenantId: visitRequests.tenantId,
      hostEmployeeId: visitRequests.hostEmployeeId,
      visitorName: visitRequests.visitorName,
      scheduledAt: visitRequests.scheduledAt,
      purpose: visitRequests.purpose,
    })
    .from(visitRequests)
    .where(
      and(
        eq(visitRequests.status, "approved"),
        isNotNull(visitRequests.scheduledAt),
        lt(visitRequests.scheduledAt, warningCutoff),
      ),
    );

  let warnings = 0;
  for (const req of warningCandidates) {
    // Skip if already transitioned to no_show above
    if (noShowIds.has(req.id)) continue;
    // Skip if a check-in already exists for this visit request
    if (visitReqsWithCheckInSet.has(req.id)) continue;

    try {
      // Publish no-show warning notification to host (push channel)
      await queue.publish(NOTIFICATION_SEND, {
        type: NOTIFICATION_SEND,
        tenantId: req.tenantId,
        actorId: "system",
        correlationId: randomUUID(),
        schemaVersion: "1.0",
        payload: buildNotificationPayload({
          eventType: EVENTS.noShowDetected,
          recipientId: req.hostEmployeeId,
          recipient: req.hostEmployeeId,
          channel: "push",
          variables: {
            visitorName: req.visitorName ?? "",
            purpose: req.purpose ?? "",
            scheduledAt: req.scheduledAt?.toISOString() ?? "",
            warningType: "no_show_30m",
            message: "Your visitor has not arrived 30 minutes after the scheduled time",
          },
        }),
      });

      warnings++;
    } catch (err) {
      logger?.warn(
        { err, visitRequestId: req.id, tenantId: req.tenantId, event: "no_show_warning_failed" },
        "failed to publish no-show warning notification",
      );
    }
  }

  if (noShows > 0 || warnings > 0) {
    logger?.info(
      { noShows, warnings, event: "no_show_cycle_complete" },
      `no-show detection cycle: ${noShows} marked no-show, ${warnings} warnings sent`,
    );
  }

  return { warnings, noShows };
}
