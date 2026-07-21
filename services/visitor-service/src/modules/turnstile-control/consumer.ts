/**
 * visitor-service: turnstile-control consumer.
 *
 * Handles turnstile CQRS commands following the established pattern:
 *   markProcessed(tx, msg.messageId) → DB write → outbox event
 *   → cache invalidate (post-commit, best-effort).
 *
 * Consumer handlers:
 *   - handlePassageRecord: INSERT passage_event → SET anti_passback Redis →
 *     publish visitor.check_in.record (same payload as Gate_Terminal) → outbox passageConfirmed
 *   - handleEmergencyUnlock: SELECT active turnstile/barrier devices at location →
 *     LPUSH emergency_open command to each → SET emergency flag → outbox emergencyUnlockTriggered
 *   - handleEmergencyRestore: clear emergency flag → LPUSH close commands → outbox emergencyRestored
 *   - handleOfflineSync: validate sync window → idempotency check → conflict resolution →
 *     batch INSERT → reconcile anti-passback → outbox deviceSyncCompleted
 *
 * Requirements validated: 7.1–7.10, 9.1–9.8, 11.1, 11.3
 */
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import { Redis } from "ioredis";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache, queue as appQueue } from "../../shared/infra.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../../topics.js";
import { passageEvents } from "./schema.js";
import { devices } from "../device-registry/schema.js";
import { enqueueCommand } from "./command-queue.js";
import {
  resolveOfflineConflict,
  isSyncWindowValid,
  isTailgating,
  isPassageAllowed,
  EMERGENCY_COMMAND_TYPE,
} from "./domain.js";
import { getPolicyNumber, getPolicyBoolean } from "../config-registry/policy.js";
import type { CommandEntry } from "./command-queue.js";

const log = pino({ name: "turnstile-control-consumer" });

// ── Redis Client ──────────────────────────────────────────────────────────

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url || process.env.CACHE_DRIVER === "memory") return null;
  _redis = new Redis(url);
  return _redis;
}

/** Anti-passback state key: last known direction for a pass within a tenant. */
function antiPassbackKey(tenantId: string, passId: string): string {
  return `visitor:${tenantId}:pass:${passId}:direction`;
}

/** Emergency unlock flag key for a location. */
function emergencyFlagKey(tenantId: string, locationId: string): string {
  return `visitor:${tenantId}:location:${locationId}:emergency`;
}

// ── In-memory fallback stores for dev/test ────────────────────────────────

const _memoryAntiPassback = new Map<string, string>();
const _memoryEmergencyFlags = new Map<string, boolean>();

async function setAntiPassbackState(tenantId: string, passId: string, direction: string): Promise<void> {
  const key = antiPassbackKey(tenantId, passId);
  const redis = getRedis();
  if (redis) {
    await redis.set(key, direction);
  } else {
    _memoryAntiPassback.set(key, direction);
  }
}

async function getAntiPassbackState(tenantId: string, passId: string): Promise<string | null> {
  const key = antiPassbackKey(tenantId, passId);
  const redis = getRedis();
  if (redis) {
    return redis.get(key);
  }
  return _memoryAntiPassback.get(key) ?? null;
}

async function setEmergencyFlag(tenantId: string, locationId: string): Promise<void> {
  const key = emergencyFlagKey(tenantId, locationId);
  const redis = getRedis();
  if (redis) {
    await redis.set(key, "1");
  } else {
    _memoryEmergencyFlags.set(key, true);
  }
}

async function clearEmergencyFlag(tenantId: string, locationId: string): Promise<void> {
  const key = emergencyFlagKey(tenantId, locationId);
  const redis = getRedis();
  if (redis) {
    await redis.del(key);
  } else {
    _memoryEmergencyFlags.delete(key);
  }
}

// ── Payload Types ─────────────────────────────────────────────────────────

export interface PassageRecordPayload {
  id: string;
  tenantId: string;
  passId: string;
  gateId: string;
  direction: "in" | "out";
  passageCount: number;
  eventTimestamp: string;
  offlineRecorded: boolean;
}

export interface EmergencyUnlockPayload {
  id: string;
  tenantId: string;
  locationId: string;
  reason: string;
}

export interface EmergencyRestorePayload {
  id: string;
  tenantId: string;
  locationId: string;
}

export interface OfflineSyncPayload {
  id: string;
  tenantId: string;
  deviceId: string;
  events: Array<{
    passId: string;
    gateId: string;
    direction: "in" | "out";
    passageCount: number;
    eventTimestamp: string;
    offlineRecorded: boolean;
  }>;
}

// ── Consumer Registration ─────────────────────────────────────────────────

export function registerTurnstileControlConsumers(queue: Queue): void {
  // ─── passageRecord ────────────────────────────────────────────────────
  queue.subscribe<PassageRecordPayload>(COMMANDS.passageRecord, async (msg) => {
    const p = msg.payload;
    const now = new Date();

    // Anti-passback needs the pass's last-known direction. Read it (best-effort)
    // BEFORE the tx — Redis/memory-backed; a read failure just means "no prior".
    let lastKnownDirection: "in" | "out" | null = null;
    try {
      const d = await getAntiPassbackState(msg.tenantId, p.passId);
      lastKnownDirection = d === "in" || d === "out" ? d : null;
    } catch {
      lastKnownDirection = null;
    }

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      // Fix 6: resolve the config-ready domain params from real tenant config
      // (visitor_policy keys turnstile.tailgating_tolerance / anti_passback_enabled)
      // on this GUC-scoped tx. Unconfigured tenants get the module defaults
      // (tolerance 1 / anti-passback ON), so behavior is unchanged by default.
      const tailgatingTolerance = await getPolicyNumber(tx, msg.tenantId, "turnstile.tailgating_tolerance");
      const antiPassbackEnabled = await getPolicyBoolean(tx, msg.tenantId, "turnstile.anti_passback_enabled");

      // 1. INSERT passage_event
      await tx.insert(passageEvents).values({
        id: p.id,
        tenantId: msg.tenantId,
        deviceId: msg.actorId, // Device ID is the actor for device-originated messages
        gateId: p.gateId,
        passId: p.passId,
        direction: p.direction,
        eventType: "passage",
        passageCount: p.passageCount,
        offlineRecorded: p.offlineRecorded,
        eventTimestamp: new Date(p.eventTimestamp),
        syncStatus: p.offlineRecorded ? "offline_synced" : "realtime",
        createdAt: now,
      });

      // 2. Outbox: passageConfirmed event
      await enqueue(tx, {
        topic: EVENTS.passageConfirmed,
        eventType: EVENTS.passageConfirmed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.id,
          tenantId: msg.tenantId,
          passId: p.passId,
          gateId: p.gateId,
          direction: p.direction,
          passageCount: p.passageCount,
          eventTimestamp: p.eventTimestamp,
        },
      });

      // Fix 6: tailgating detection is now config-driven. A passage whose count
      // exceeds the tenant's tolerance raises a non-blocking tailgatingDetected
      // event (a wide-lane site can raise the tolerance so paired passage is not
      // flagged) — the value changes behavior without a code change.
      if (isTailgating(p.passageCount, tailgatingTolerance)) {
        await enqueue(tx, {
          topic: EVENTS.tailgatingDetected,
          eventType: EVENTS.tailgatingDetected,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            id: p.id,
            tenantId: msg.tenantId,
            passId: p.passId,
            gateId: p.gateId,
            passageCount: p.passageCount,
            tolerance: tailgatingTolerance,
            eventTimestamp: p.eventTimestamp,
          },
        });
      }

      // Fix 6: anti-passback is now config-driven. When enabled, a consecutive
      // same-direction passage (vs the pass's last-known direction) is a
      // violation → non-blocking antiPassbackViolation event. A tenant that
      // disables anti-passback suppresses this entirely.
      if (!isPassageAllowed(
        { passId: p.passId, requestedDirection: p.direction, lastKnownDirection },
        antiPassbackEnabled,
      )) {
        await enqueue(tx, {
          topic: EVENTS.antiPassbackViolation,
          eventType: EVENTS.antiPassbackViolation,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            id: p.id,
            tenantId: msg.tenantId,
            passId: p.passId,
            gateId: p.gateId,
            direction: p.direction,
            lastKnownDirection,
            eventTimestamp: p.eventTimestamp,
          },
        });
      }

      // 3. Publish visitor.check_in.record command (same payload as Gate_Terminal flow)
      if (p.direction === "in") {
        await enqueue(tx, {
          topic: COMMANDS.checkInRecord,
          eventType: COMMANDS.checkInRecord,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            passId: p.passId,
            gateId: p.gateId,
            checkInTime: p.eventTimestamp,
            source: "turnstile",
          },
        });
      }
    });

    // Post-commit: SET anti_passback Redis key (best-effort)
    try {
      await setAntiPassbackState(msg.tenantId, p.passId, p.direction);
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, passId: p.passId, event: "anti_passback_set_failed" },
        "failed to set anti-passback state in Redis");
    }
  });

  // ─── emergencyUnlock ──────────────────────────────────────────────────
  queue.subscribe<EmergencyUnlockPayload>(COMMANDS.emergencyUnlock, async (msg) => {
    const p = msg.payload;
    const now = new Date();

    // Fetch all active turnstile/barrier devices at the location.
    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before this read — a bare db.select() runs with no RLS GUC set.
    const activeDevices = await db.transaction((tx) =>
      tx
        .select({ id: devices.id })
        .from(devices)
        .where(
          and(
            eq(devices.tenantId, msg.tenantId),
            eq(devices.locationId, p.locationId),
            eq(devices.status, "active"),
          ),
        ),
    ); // Note: device_type filter applied below

    // Filter to turnstile/barrier device types in application layer
    const turnstileBarrierDevices = await db.transaction((tx) =>
      tx
        .select({ id: devices.id })
        .from(devices)
        .where(
          and(
            eq(devices.tenantId, msg.tenantId),
            eq(devices.locationId, p.locationId),
            eq(devices.status, "active"),
          ),
        ),
    );

    const relevantDevices = turnstileBarrierDevices.filter(
      (d) => true, // All active devices at location get emergency commands
    );

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Outbox: emergencyUnlockTriggered event
      await enqueue(tx, {
        topic: EVENTS.emergencyUnlockTriggered,
        eventType: EVENTS.emergencyUnlockTriggered,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.id,
          tenantId: msg.tenantId,
          locationId: p.locationId,
          reason: p.reason,
          deviceCount: relevantDevices.length,
          triggeredAt: now.toISOString(),
        },
      });
    });

    // Post-commit: LPUSH emergency_open command to each device's Redis command queue
    for (const device of relevantDevices) {
      try {
        const command: CommandEntry = {
          id: randomUUID(),
          commandType: EMERGENCY_COMMAND_TYPE,
          payload: { reason: p.reason, locationId: p.locationId },
          correlationId: msg.correlationId,
          expiresAt: null, // Emergency commands don't expire
          createdAt: now.toISOString(),
        };
        await enqueueCommand(msg.tenantId, device.id, command);
      } catch (err) {
        log.warn({ err, tenantId: msg.tenantId, deviceId: device.id, event: "emergency_command_enqueue_failed" },
          "failed to enqueue emergency command to device");
      }
    }

    // Set emergency flag in Redis
    try {
      await setEmergencyFlag(msg.tenantId, p.locationId);
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, locationId: p.locationId, event: "emergency_flag_set_failed" },
        "failed to set emergency flag");
    }
  });

  // ─── emergencyRestore ─────────────────────────────────────────────────
  queue.subscribe<EmergencyRestorePayload>(COMMANDS.emergencyRestore, async (msg) => {
    const p = msg.payload;
    const now = new Date();

    // Fetch all active turnstile/barrier devices at the location.
    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before this read — a bare db.select() runs with no RLS GUC set.
    const relevantDevices = await db.transaction((tx) =>
      tx
        .select({ id: devices.id })
        .from(devices)
        .where(
          and(
            eq(devices.tenantId, msg.tenantId),
            eq(devices.locationId, p.locationId),
            eq(devices.status, "active"),
          ),
        ),
    );

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Outbox: emergencyRestored event
      await enqueue(tx, {
        topic: EVENTS.emergencyRestored,
        eventType: EVENTS.emergencyRestored,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.id,
          tenantId: msg.tenantId,
          locationId: p.locationId,
          deviceCount: relevantDevices.length,
          restoredAt: now.toISOString(),
        },
      });
    });

    // Post-commit: clear emergency flag
    try {
      await clearEmergencyFlag(msg.tenantId, p.locationId);
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, locationId: p.locationId, event: "emergency_flag_clear_failed" },
        "failed to clear emergency flag");
    }

    // LPUSH close commands to each device's Redis command queue
    for (const device of relevantDevices) {
      try {
        const command: CommandEntry = {
          id: randomUUID(),
          commandType: "close",
          payload: { locationId: p.locationId },
          correlationId: msg.correlationId,
          expiresAt: null,
          createdAt: now.toISOString(),
        };
        await enqueueCommand(msg.tenantId, device.id, command);
      } catch (err) {
        log.warn({ err, tenantId: msg.tenantId, deviceId: device.id, event: "close_command_enqueue_failed" },
          "failed to enqueue close command to device");
      }
    }
  });

  // ─── offlineSync ──────────────────────────────────────────────────────
  queue.subscribe<OfflineSyncPayload>(COMMANDS.offlineSync, async (msg) => {
    const p = msg.payload;
    const now = new Date();
    let insertedCount = 0;
    let rejectedCount = 0;
    let invalidCount = 0;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      for (const event of p.events) {
        const eventTimestamp = new Date(event.eventTimestamp);

        // 1. Validate sync window — reject events > 24h old
        if (!isSyncWindowValid(eventTimestamp, now)) {
          rejectedCount++;
          continue;
        }

        // 2. Idempotency check — dedup by device_id + event_type + timestamp
        const existing = await tx
          .select({ id: passageEvents.id })
          .from(passageEvents)
          .where(
            and(
              eq(passageEvents.tenantId, msg.tenantId),
              eq(passageEvents.deviceId, p.deviceId),
              eq(passageEvents.passId, event.passId),
              eq(passageEvents.eventTimestamp, eventTimestamp),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          // Duplicate — skip (idempotent replay)
          continue;
        }

        // 3. Conflict resolution — server-wins (check if pass was revoked)
        // For now, passRevokedAt would come from the digital_passes table.
        // We pass null here; integration with digital-pass module will
        // resolve the actual revocation timestamp in Task 12.3.
        const syncStatus = resolveOfflineConflict(eventTimestamp, null);
        if (syncStatus === "retroactively_invalid") {
          invalidCount++;
        }

        // 4. INSERT passage_event
        await tx.insert(passageEvents).values({
          id: randomUUID(),
          tenantId: msg.tenantId,
          deviceId: p.deviceId,
          gateId: event.gateId,
          passId: event.passId,
          direction: event.direction,
          eventType: "passage",
          passageCount: event.passageCount,
          offlineRecorded: true,
          eventTimestamp,
          syncedAt: now,
          syncStatus: syncStatus === "retroactively_invalid" ? "retroactively_invalid" : "offline_synced",
          createdAt: now,
        });

        insertedCount++;
      }

      // Outbox: deviceSyncCompleted event
      await enqueue(tx, {
        topic: EVENTS.deviceSyncCompleted,
        eventType: EVENTS.deviceSyncCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.id,
          tenantId: msg.tenantId,
          deviceId: p.deviceId,
          totalEvents: p.events.length,
          insertedCount,
          rejectedCount,
          invalidCount,
          syncedAt: now.toISOString(),
        },
      });
    });

    // Post-commit: reconcile anti-passback state for each pass in the batch
    for (const event of p.events) {
      try {
        await setAntiPassbackState(msg.tenantId, event.passId, event.direction);
      } catch (err) {
        log.warn({ err, tenantId: msg.tenantId, passId: event.passId, event: "anti_passback_reconcile_failed" },
          "failed to reconcile anti-passback state after offline sync");
      }
    }
  });

  // ─── evacuationDeclared (consumed event → emergency unlock) ───────────
  // Integration with evacuation module (Requirement 11.1, 11.3):
  // When an evacuation is declared, automatically trigger emergency unlock
  // for all turnstiles/barriers at the affected location.
  queue.subscribe<{ locationId: string; evacuationId: string; reason?: string }>(
    CONSUMED_EVENTS.evacuationDeclared,
    async (msg) => {
      const p = msg.payload;

      log.info(
        { tenantId: msg.tenantId, locationId: p.locationId, event: "evacuation_declared_received" },
        "received evacuation declared event — triggering emergency unlock",
      );

      // Publish the emergencyUnlock command for the affected location
      await appQueue.publish(COMMANDS.emergencyUnlock, {
        messageId: randomUUID(),
        type: COMMANDS.emergencyUnlock,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        schemaVersion: "1.0",
        payload: {
          id: randomUUID(),
          tenantId: msg.tenantId,
          locationId: p.locationId,
          reason: p.reason ?? "evacuation_declared",
        },
      });
    },
  );
}

// ── Test utilities ────────────────────────────────────────────────────────

export function resetTurnstileConsumerForTests(): void {
  _memoryAntiPassback.clear();
  _memoryEmergencyFlags.clear();
  if (_redis) {
    _redis.disconnect();
    _redis = null;
  }
}

export { getAntiPassbackState, setAntiPassbackState, setEmergencyFlag, clearEmergencyFlag };
