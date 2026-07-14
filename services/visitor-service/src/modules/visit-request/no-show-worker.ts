/**
 * Scheduled worker task: no-show detection.
 *
 * Runs every 15 minutes (configurable) and performs two checks:
 *
 * 1. **30-minute warning** (Requirement 16.3): finds approved visit requests
 *    whose `scheduledAt` is more than 30 minutes in the past with no
 *    associated check-in, and enqueues a NOTIFICATION_SEND warning to the
 *    host employee (push channel).
 *
 * 2. **2-hour auto no-show** (Requirement 16.4): finds approved visit requests
 *    whose `scheduledAt` is more than 2 hours in the past with no associated
 *    check-in, transitions them to 'no_show' status, releases any allocated
 *    parking slot, and emits a noShowDetected event.
 *
 * Transactional outbox (Fix 5): the no_show transition, the parking-slot
 * release, and the noShowDetected event are all written in ONE per-tenant
 * `db.transaction` via `enqueue` (not raw `queue.publish` outside a tx). This
 * makes them atomic with the state transition — `versionedUpdate`'s
 * compare-and-swap means a concurrent check-in that already advanced the row
 * throws VersionConflictError and rolls the WHOLE unit back, so no duplicate /
 * orphaned no_show event is ever published. The cross-tenant SCAN still uses the
 * BYPASSRLS `scannerDb`; every WRITE runs on the primary `db` under the row's
 * tenant so RLS applies. The relay forwards the stable outbox-row id, so a
 * crash between commit and publish cannot lose or double-fire the event.
 */
import { randomUUID } from "node:crypto";
import { and, eq, lt, isNotNull, inArray } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { COMMANDS, EVENTS } from "../../topics.js";
import { visitRequests } from "./schema.js";
import { digitalPasses } from "../digital-pass/schema.js";
import { vehiclePasses } from "../vehicle-pass/schema.js";
import { checkIns } from "../check-in/schema.js";
import type { Db } from "../../shared/db.js";
import { enqueue, versionedUpdate } from "../../shared/outbox.js";
import { loadNamespaceOverrides } from "../config-registry/repo.js";
import { POLICY_NS, toNumber, MS_PER_MINUTE, MS_PER_HOUR } from "../config-registry/policy.js";

/** Zero-UUID system actor for worker-originated outbox rows (actor_id is uuid NOT NULL). */
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

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
  scannerDb: Db = db,
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
        await processNoShowCycle(db, queue, warningThresholdMs, noShowThresholdMs, logger, scannerDb);
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
 *
 * `queue` is retained in the signature for source/call-site compatibility but is
 * no longer used to publish — all emissions now go through the transactional
 * outbox (`enqueue`) so they are durable + idempotent (Fix 5).
 */
export async function processNoShowCycle(
  db: Db,
  queue: Queue,
  warningThresholdMs: number,
  noShowThresholdMs: number,
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void },
  scannerDb: Db = db,
): Promise<{ warnings: number; noShows: number }> {
  void queue;
  const now = new Date();

  // Per-tenant thresholds are config-driven (visitor_policy keys
  // visit_request.no_show_warning_minutes / visit_request.no_show_hours). Tenant
  // override wins over the passed default; scan widened to the smallest threshold
  // then re-checked per candidate against its tenant's own threshold. Unchanged
  // when nothing is configured.
  const overrides = await loadNamespaceOverrides(scannerDb, POLICY_NS);
  const warningMsFor = (t: string) => {
    const m = toNumber(overrides.get(t)?.get("visit_request.no_show_warning_minutes"));
    return m !== undefined ? m * MS_PER_MINUTE : warningThresholdMs;
  };
  const noShowMsFor = (t: string) => {
    const h = toNumber(overrides.get(t)?.get("visit_request.no_show_hours"));
    return h !== undefined ? h * MS_PER_HOUR : noShowThresholdMs;
  };
  const minWarningMs = Math.min(warningThresholdMs, ...[...overrides.keys()].map(warningMsFor));
  const minNoShowMs = Math.min(noShowThresholdMs, ...[...overrides.keys()].map(noShowMsFor));

  const warningCutoff = new Date(now.getTime() - minWarningMs);
  const noShowCutoff = new Date(now.getTime() - minNoShowMs);

  // ── Step 1: Find visit request IDs that have a check-in (exclude) ────
  // A check-in is linked to a visit request through the digital pass.
  // Get all pass IDs that have at least one check-in (direction='in').
  const checkedInPassRows = await scannerDb
    .selectDistinct({ passId: checkIns.passId })
    .from(checkIns)
    .where(eq(checkIns.direction, "in"));
  const checkedInPassIds = checkedInPassRows.map((r) => r.passId);

  // Map checked-in pass IDs to their visit request IDs
  let visitReqIdsWithCheckIn: string[] = [];
  if (checkedInPassIds.length > 0) {
    const passToVisitRows = await scannerDb
      .selectDistinct({ visitRequestId: digitalPasses.visitRequestId })
      .from(digitalPasses)
      .where(inArray(digitalPasses.id, checkedInPassIds));
    visitReqIdsWithCheckIn = passToVisitRows.map((r) => r.visitRequestId);
  }
  const visitReqsWithCheckInSet = new Set(visitReqIdsWithCheckIn);

  // ── Step 2: Auto no-show for requests older than 2h ──────────────────
  // Query approved visit requests with scheduledAt before the no-show cutoff
  const noShowCandidates = await scannerDb
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
    // Re-check against this tenant's own no-show threshold (scan was widened).
    if (!req.scheduledAt || now.getTime() - req.scheduledAt.getTime() <= noShowMsFor(req.tenantId)) continue;

    try {
      // Read vehicle-pass rows FIRST (cross-tenant scanner read) so the parking
      // release can be enqueued transactionally with the no_show transition.
      const vehiclePassRows = await scannerDb
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

      // Transition to no_show + release parking + emit noShowDetected ATOMICALLY
      // inside the row's tenant scope (RLS-checked). versionedUpdate is a
      // compare-and-swap on version: a concurrent check-in that already advanced
      // the row throws VersionConflictError, rolling back the whole tx — so no
      // duplicate no_show event or orphaned parking release is ever published.
      await runWithTenant(req.tenantId, () =>
        db.transaction(async (tx) => {
          await versionedUpdate(tx, visitRequests, {
            id: req.id,
            tenantId: req.tenantId,
            expectedVersion: req.version,
            set: {
              status: "no_show",
              updatedAt: now,
              updatedBy: SYSTEM_ACTOR,
            },
            entity: "visit_request",
          });

          // Release parking slot(s) if a vehicle pass exists — transactional outbox.
          for (const vp of vehiclePassRows) {
            if (vp.parkingSlotId) {
              await enqueue(tx, {
                topic: COMMANDS.parkingSlotRelease,
                eventType: COMMANDS.parkingSlotRelease,
                tenantId: req.tenantId,
                actorId: SYSTEM_ACTOR,
                correlationId: randomUUID(),
                payload: {
                  vehiclePassId: vp.id,
                  parkingSlotId: vp.parkingSlotId,
                  reason: "no_show",
                },
              });
            }
          }

          // noShowDetected event — transactional outbox (atomic with the transition).
          await enqueue(tx, {
            topic: EVENTS.noShowDetected,
            eventType: EVENTS.noShowDetected,
            tenantId: req.tenantId,
            actorId: SYSTEM_ACTOR,
            correlationId: randomUUID(),
            payload: {
              id: req.id,
              tenantId: req.tenantId,
              hostEmployeeId: req.hostEmployeeId,
              locationId: req.locationId,
              scheduledAt: req.scheduledAt?.toISOString() ?? "",
              detectedAt: now.toISOString(),
            },
          });
        }),
      );

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
  const warningCandidates = await scannerDb
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
    // Re-check against this tenant's own warning threshold (scan was widened).
    if (!req.scheduledAt || now.getTime() - req.scheduledAt.getTime() <= warningMsFor(req.tenantId)) continue;

    try {
      // Transactional outbox: enqueue the no-show warning to host (push channel)
      // inside a per-tenant tx, instead of a raw queue.publish outside any tx.
      await runWithTenant(req.tenantId, () =>
        db.transaction((tx) =>
          enqueue(tx, {
            topic: NOTIFICATION_SEND,
            eventType: NOTIFICATION_SEND,
            tenantId: req.tenantId,
            actorId: SYSTEM_ACTOR,
            correlationId: randomUUID(),
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
          }),
        ),
      );

      warnings++;
    } catch (err) {
      logger?.warn(
        { err, visitRequestId: req.id, tenantId: req.tenantId, event: "no_show_warning_failed" },
        "failed to enqueue no-show warning notification",
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
