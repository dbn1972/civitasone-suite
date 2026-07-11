/**
 * visitor-service: device-registry health checker (scheduled worker).
 *
 * Runs every 30 seconds and scans all active devices to detect offline status.
 * Uses the Redis heartbeat TTL pattern: when a device's `lastSeenAt` Redis key
 * expires (TTL 90s, 3 missed heartbeats), the device is considered offline.
 *
 * Actions on offline detection:
 *   1. Update device `online = false` in DB
 *   2. Publish `visitor.device.health.offline` event via outbox
 *   3. If offline > 2 minutes (OFFLINE_ALERT_DELAY_MS): send critical alert
 *      via NOTIFICATION_SEND to facility operations
 *
 * Actions on online recovery (heartbeat resets Redis key):
 *   1. Update device `online = true` in DB
 *   2. Publish `visitor.device.health.online` event
 *
 * Updates location health dashboard cache after each scan cycle:
 *   Key: `visitor:{tenantId}:location:{locationId}:device_health`
 *   Value: `{ total, online, offline, offlineDevices: [...] }`
 *
 * Requirements validated: 3.2, 3.3, 3.4, 3.5, 3.6, 3.8
 */
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache, queue } from "../../shared/infra.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import { devices } from "./schema.js";
import { OFFLINE_ALERT_DELAY_MS, HEARTBEAT_TTL_SECONDS } from "./domain.js";
import type { LocationHealthSummary } from "./repo.js";

const log = pino({ name: "device-health-checker" });

/** Interval between health-checker runs (30 seconds). */
const CHECK_INTERVAL_MS = 30_000;

/** Redis key pattern for device heartbeat status (set by heartbeat route). */
function heartbeatKey(tenantId: string, deviceId: string): string {
  return `visitor:${tenantId}:device:${deviceId}:heartbeat`;
}

/** Redis key for location health dashboard cache. */
function locationHealthKey(tenantId: string, locationId: string): string {
  return `visitor:${tenantId}:location:${locationId}:device_health`;
}

/** Timer handle for the scheduled worker. */
let _intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the health-checker scheduled worker.
 * Runs every 30 seconds and checks all active devices for offline status.
 */
export function startHealthChecker(): void {
  if (_intervalHandle) return; // Already running
  log.info({ event: "health_checker_started", intervalMs: CHECK_INTERVAL_MS },
    "device health checker started");
  _intervalHandle = setInterval(() => {
    runHealthCheck().catch((err) => {
      log.error({ err, event: "health_check_cycle_error" },
        "unexpected error during health check cycle");
    });
  }, CHECK_INTERVAL_MS);
}

/**
 * Stop the health-checker scheduled worker.
 * Used during graceful shutdown (SIGTERM handling).
 */
export function stopHealthChecker(): void {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
    log.info({ event: "health_checker_stopped" }, "device health checker stopped");
  }
}

/**
 * Run a single health check cycle.
 * Exported for testing — in production, called by the interval timer.
 */
export async function runHealthCheck(): Promise<void> {
  // Query all active devices (across all tenants — this worker is system-level)
  const activeDevices = await db
    .select()
    .from(devices)
    .where(eq(devices.status, "active"));

  if (activeDevices.length === 0) return;

  // Group devices by tenant for batch processing
  const byTenant = new Map<string, typeof activeDevices>();
  for (const device of activeDevices) {
    const group = byTenant.get(device.tenantId) ?? [];
    group.push(device);
    byTenant.set(device.tenantId, group);
  }

  for (const [tenantId, tenantDevices] of byTenant) {
    await processTenantsDevices(tenantId, tenantDevices);
  }
}

/**
 * Process all devices for a single tenant: detect offline/online transitions
 * and update the location health dashboard cache.
 */
async function processTenantsDevices(
  tenantId: string,
  tenantDevices: Array<typeof devices.$inferSelect>,
): Promise<void> {
  const now = new Date();
  const locationUpdates = new Map<string, typeof tenantDevices>();

  for (const device of tenantDevices) {
    // Group by location for dashboard update
    const locationGroup = locationUpdates.get(device.locationId) ?? [];
    locationGroup.push(device);
    locationUpdates.set(device.locationId, locationGroup);

    // Check if device heartbeat key exists in Redis (TTL-based online detection)
    const hbKey = heartbeatKey(tenantId, device.id);
    const heartbeatExists = await cache.getOrLoad<string>(hbKey, async () => null, HEARTBEAT_TTL_SECONDS);

    const isOnlineInRedis = heartbeatExists !== null;

    if (device.online && !isOnlineInRedis) {
      // Device was online but heartbeat expired → transition to offline
      await transitionToOffline(tenantId, device, now);
    } else if (!device.online && isOnlineInRedis) {
      // Device was offline but heartbeat came back → transition to online
      await transitionToOnline(tenantId, device, now);
    } else if (!device.online && !isOnlineInRedis) {
      // Device still offline — check if alert threshold exceeded
      await checkOfflineAlert(tenantId, device, now);
    }
    // else: device is online and heartbeat exists — no action needed
  }

  // Update location health dashboard cache for all affected locations
  for (const [locationId, locationDevices] of locationUpdates) {
    await updateLocationHealthCache(tenantId, locationId, locationDevices);
  }
}

/**
 * Transition a device from online to offline.
 * Updates DB, publishes offline event via outbox.
 */
async function transitionToOffline(
  tenantId: string,
  device: typeof devices.$inferSelect,
  now: Date,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(devices)
        .set({ online: false, updatedAt: now })
        .where(and(eq(devices.id, device.id), eq(devices.tenantId, tenantId)));

      // Publish offline event via outbox
      await enqueue(tx, {
        topic: EVENTS.deviceHealthOffline,
        eventType: EVENTS.deviceHealthOffline,
        tenantId,
        actorId: "system",
        correlationId: device.id,
        payload: {
          deviceId: device.id,
          tenantId,
          deviceType: device.deviceType,
          locationId: device.locationId,
          name: device.name,
          lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        },
      });
    });

    log.info({
      event: "device_offline",
      tenantId,
      deviceId: device.id,
      deviceType: device.deviceType,
      locationId: device.locationId,
    }, `device '${device.name}' went offline`);
  } catch (err) {
    log.error({ err, tenantId, deviceId: device.id, event: "offline_transition_error" },
      "failed to transition device to offline");
  }
}

/**
 * Transition a device from offline to online.
 * Updates DB, publishes online event via outbox.
 */
async function transitionToOnline(
  tenantId: string,
  device: typeof devices.$inferSelect,
  now: Date,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(devices)
        .set({ online: true, updatedAt: now })
        .where(and(eq(devices.id, device.id), eq(devices.tenantId, tenantId)));

      // Publish online event via outbox
      await enqueue(tx, {
        topic: EVENTS.deviceHealthOnline,
        eventType: EVENTS.deviceHealthOnline,
        tenantId,
        actorId: "system",
        correlationId: device.id,
        payload: {
          deviceId: device.id,
          tenantId,
          deviceType: device.deviceType,
          locationId: device.locationId,
          name: device.name,
        },
      });
    });

    log.info({
      event: "device_online",
      tenantId,
      deviceId: device.id,
      deviceType: device.deviceType,
      locationId: device.locationId,
    }, `device '${device.name}' came back online`);
  } catch (err) {
    log.error({ err, tenantId, deviceId: device.id, event: "online_transition_error" },
      "failed to transition device to online");
  }
}

/**
 * Check if an offline device has exceeded the alert delay threshold (2 minutes).
 * If so, send a critical alert to facility operations via NOTIFICATION_SEND.
 */
async function checkOfflineAlert(
  tenantId: string,
  device: typeof devices.$inferSelect,
  now: Date,
): Promise<void> {
  if (!device.lastSeenAt) return; // Never seen — skip alert (device may not have sent first heartbeat)

  const offlineDuration = now.getTime() - device.lastSeenAt.getTime();
  if (offlineDuration <= OFFLINE_ALERT_DELAY_MS) return; // Not yet past alert threshold

  // Check if we already sent an alert for this offline period (avoid alert spam).
  // Use a Redis flag with TTL matching the check interval to prevent duplicate alerts.
  const alertKey = `visitor:${tenantId}:device:${device.id}:offline_alert_sent`;
  const alreadySent = await cache.getOrLoad<string>(alertKey, async () => null, CHECK_INTERVAL_MS / 1000);
  if (alreadySent !== null) return;

  try {
    // Mark alert as sent (TTL = 5 minutes to avoid repeating within short window)
    await cache.put(alertKey, "1", 300);

    // Send critical alert via NOTIFICATION_SEND
    await queue.publish(NOTIFICATION_SEND, {
      type: NOTIFICATION_SEND,
      tenantId,
      actorId: "system",
      correlationId: device.id,
      schemaVersion: "1.0",
      payload: buildNotificationPayload({
        eventType: "visitor.device.health.offline",
        recipient: `tenant:${tenantId}:facility_ops`,
        channel: "push",
        variables: {
          deviceId: device.id,
          deviceName: device.name,
          deviceType: device.deviceType,
          locationId: device.locationId,
          lastSeenAt: device.lastSeenAt.toISOString(),
          offlineDurationMinutes: String(Math.floor(offlineDuration / 60_000)),
        },
      }),
    });

    log.warn({
      event: "device_offline_alert",
      tenantId,
      deviceId: device.id,
      offlineDurationMs: offlineDuration,
    }, `critical alert: device '${device.name}' offline for ${Math.floor(offlineDuration / 60_000)} minutes`);
  } catch (err) {
    log.error({ err, tenantId, deviceId: device.id, event: "offline_alert_error" },
      "failed to send offline alert notification");
  }
}

/**
 * Update the location health dashboard cache entry.
 * Stored at: `visitor:{tenantId}:location:{locationId}:device_health`
 */
async function updateLocationHealthCache(
  tenantId: string,
  locationId: string,
  locationDevices: Array<typeof devices.$inferSelect>,
): Promise<void> {
  const activeDevices = locationDevices.filter((d) => d.status === "active");
  const onlineDevices = activeDevices.filter((d) => d.online);
  const offlineDevices = activeDevices.filter((d) => !d.online);

  const summary: LocationHealthSummary = {
    locationId,
    total: activeDevices.length,
    online: onlineDevices.length,
    offline: offlineDevices.length,
    offlineDevices: offlineDevices.map((d) => ({
      deviceId: d.id,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      name: d.name,
    })),
  };

  try {
    const key = locationHealthKey(tenantId, locationId);
    await cache.put(key, summary, 120); // TTL 2 minutes (refreshed every 30s)
  } catch (err) {
    log.warn({ err, tenantId, locationId, event: "location_health_cache_error" },
      "failed to update location health dashboard cache");
  }
}
