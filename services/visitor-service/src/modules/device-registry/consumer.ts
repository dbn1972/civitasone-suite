/**
 * visitor-service: device-registry consumer.
 *
 * Handles device lifecycle CQRS commands following the established pattern:
 *   markProcessed(tx, msg.messageId) → DB write → audit log → outbox event
 *   → cache invalidate (post-commit, best-effort).
 *
 * Each handler operates within a single DB transaction. The outbox relay
 * publishes events after commit (transactional outbox guarantee).
 *
 * Requirements validated: 1.1, 1.8, 1.10, 2.4, 8.2, 8.6, 8.7, 10.2
 */
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { devices, deviceAuditLog, deviceConfigs } from "./schema.js";
import { generateDeviceToken, canTransition, getAuthType } from "./domain.js";

const log = pino({ name: "device-registry-consumer" });

/** Cache resource key for device records. */
const RESOURCE = "device";

// ── Payload Types ─────────────────────────────────────────────────────────

export interface DeviceRegisterPayload {
  id: string;
  tenantId: string;
  deviceType: string;
  name: string;
  serialNumber: string;
  locationId: string;
  gateId: string | null;
  capabilities: Record<string, string[]>;
}

export interface DeviceActivatePayload {
  deviceId: string;
  tenantId: string;
}

export interface DeviceSuspendPayload {
  deviceId: string;
  tenantId: string;
  reason: string | null;
}

export interface DeviceDeregisterPayload {
  deviceId: string;
  tenantId: string;
  reason: string | null;
}

export interface DeviceRotateCredentialPayload {
  deviceId: string;
  tenantId: string;
}

export interface DeviceConfigPushPayload {
  deviceId: string;
  tenantId: string;
  config: Record<string, unknown>;
}

export interface DeviceBulkConfigPushPayload {
  tenantId: string;
  deviceType: string;
  locationId: string;
  config: Record<string, unknown>;
}

export interface DeviceHeartbeatPayload {
  deviceId: string;
  tenantId: string;
  firmwareVersion: string;
  lastSeenAt: string;
}

export interface DeviceFirmwareSchedulePayload {
  deviceId: string;
  tenantId: string;
  firmwareUrl: string;
  firmwareChecksum: string;
}

// ── Consumer Registration ─────────────────────────────────────────────────

export function registerDeviceRegistryConsumers(queue: Queue): void {
  // ─── deviceRegister ─────────────────────────────────────────────────
  queue.subscribe<DeviceRegisterPayload>(COMMANDS.deviceRegister, async (msg) => {
    const p = msg.payload;
    const authType = getAuthType(p.deviceType);

    // Generate credentials based on auth type
    let tokenHash: string | null = null;
    let rawToken: string | null = null;
    if (authType === "bearer_token") {
      const cred = generateDeviceToken();
      tokenHash = cred.hash;
      rawToken = cred.token;
    }

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      await tx.insert(devices).values({
        id: p.id,
        tenantId: msg.tenantId,
        deviceType: p.deviceType,
        name: p.name,
        serialNumber: p.serialNumber,
        locationId: p.locationId,
        gateId: p.gateId,
        status: "pending_activation",
        authType,
        deviceTokenHash: tokenHash,
        capabilities: p.capabilities,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      // Audit log
      await tx.insert(deviceAuditLog).values({
        tenantId: msg.tenantId,
        deviceId: p.id,
        action: "registered",
        details: { deviceType: p.deviceType, serialNumber: p.serialNumber, authType },
        actorId: msg.actorId,
      });

      // Outbox: deviceRegistered event
      await enqueue(tx, {
        topic: EVENTS.deviceRegistered,
        eventType: EVENTS.deviceRegistered,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.id,
          tenantId: msg.tenantId,
          deviceType: p.deviceType,
          name: p.name,
          serialNumber: p.serialNumber,
          locationId: p.locationId,
          authType,
          status: "pending_activation",
          // Include raw token in event so the caller (via webhook/notification)
          // can deliver it to the device. This event is INTERNAL only.
          ...(rawToken ? { token: rawToken } : {}),
        },
      });
    });

    // Post-commit: invalidate cache (best-effort)
    try {
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, p.id));
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, deviceId: p.id, event: "cache_invalidate_failed" },
        "device cache invalidation failed after register; cache will self-heal on TTL expiry");
    }
  });

  // ─── deviceActivate ─────────────────────────────────────────────────
  queue.subscribe<DeviceActivatePayload>(COMMANDS.deviceActivate, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const rows = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.id, p.deviceId), eq(devices.tenantId, msg.tenantId)))
        .limit(1);
      const device = rows[0];
      if (!device) {
        throw new Error(`device '${p.deviceId}' not found for tenant '${msg.tenantId}'`);
      }

      if (!canTransition(device.status as "pending_activation" | "active" | "suspended" | "deregistered", "active")) {
        throw new Error(`invalid transition from '${device.status}' to 'active' for device '${p.deviceId}'`);
      }

      await versionedUpdate(tx, devices, {
        id: p.deviceId,
        tenantId: msg.tenantId,
        expectedVersion: device.version,
        set: {
          status: "active",
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        },
        entity: "device",
      });

      // Audit log
      await tx.insert(deviceAuditLog).values({
        tenantId: msg.tenantId,
        deviceId: p.deviceId,
        action: "activated",
        details: { previousStatus: device.status },
        actorId: msg.actorId,
      });

      // Outbox: deviceActivated event
      await enqueue(tx, {
        topic: EVENTS.deviceActivated,
        eventType: EVENTS.deviceActivated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.deviceId,
          tenantId: msg.tenantId,
          status: "active",
          previousStatus: device.status,
        },
      });
    });

    try {
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, p.deviceId));
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, deviceId: p.deviceId, event: "cache_invalidate_failed" },
        "device cache invalidation failed after activate");
    }
  });

  // ─── deviceSuspend ──────────────────────────────────────────────────
  queue.subscribe<DeviceSuspendPayload>(COMMANDS.deviceSuspend, async (msg) => {
    const p = msg.payload;

    let tokenHashToRevoke: string | null = null;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const rows = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.id, p.deviceId), eq(devices.tenantId, msg.tenantId)))
        .limit(1);
      const device = rows[0];
      if (!device) {
        throw new Error(`device '${p.deviceId}' not found for tenant '${msg.tenantId}'`);
      }

      if (!canTransition(device.status as "pending_activation" | "active" | "suspended" | "deregistered", "suspended")) {
        throw new Error(`invalid transition from '${device.status}' to 'suspended' for device '${p.deviceId}'`);
      }

      tokenHashToRevoke = device.deviceTokenHash;

      await versionedUpdate(tx, devices, {
        id: p.deviceId,
        tenantId: msg.tenantId,
        expectedVersion: device.version,
        set: {
          status: "suspended",
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        },
        entity: "device",
      });

      // Audit log
      await tx.insert(deviceAuditLog).values({
        tenantId: msg.tenantId,
        deviceId: p.deviceId,
        action: "suspended",
        details: { previousStatus: device.status, reason: p.reason },
        actorId: msg.actorId,
      });

      // Outbox: deviceSuspended event
      await enqueue(tx, {
        topic: EVENTS.deviceSuspended,
        eventType: EVENTS.deviceSuspended,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.deviceId,
          tenantId: msg.tenantId,
          status: "suspended",
          previousStatus: device.status,
          reason: p.reason,
        },
      });
    });

    // Post-commit: revoke cached token + invalidate device cache (best-effort)
    try {
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, p.deviceId));
      if (tokenHashToRevoke) {
        await cache.invalidate(cache.makeKey("__device_auth__", "token_hash", tokenHashToRevoke));
      }
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, deviceId: p.deviceId, event: "cache_invalidate_failed" },
        "device cache invalidation failed after suspend");
    }
  });

  // ─── deviceDeregister ───────────────────────────────────────────────
  queue.subscribe<DeviceDeregisterPayload>(COMMANDS.deviceDeregister, async (msg) => {
    const p = msg.payload;

    let tokenHashToRevoke: string | null = null;
    let certFingerprint: string | null = null;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const rows = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.id, p.deviceId), eq(devices.tenantId, msg.tenantId)))
        .limit(1);
      const device = rows[0];
      if (!device) {
        throw new Error(`device '${p.deviceId}' not found for tenant '${msg.tenantId}'`);
      }

      if (!canTransition(device.status as "pending_activation" | "active" | "suspended" | "deregistered", "deregistered")) {
        throw new Error(`invalid transition from '${device.status}' to 'deregistered' for device '${p.deviceId}'`);
      }

      tokenHashToRevoke = device.deviceTokenHash;
      certFingerprint = device.certificateFingerprint;

      await versionedUpdate(tx, devices, {
        id: p.deviceId,
        tenantId: msg.tenantId,
        expectedVersion: device.version,
        set: {
          status: "deregistered",
          deviceTokenHash: null,
          certificateFingerprint: null,
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        },
        entity: "device",
      });

      // Audit log
      await tx.insert(deviceAuditLog).values({
        tenantId: msg.tenantId,
        deviceId: p.deviceId,
        action: "deregistered",
        details: { previousStatus: device.status, reason: p.reason },
        actorId: msg.actorId,
      });

      // Outbox: deviceDeregistered event
      await enqueue(tx, {
        topic: EVENTS.deviceDeregistered,
        eventType: EVENTS.deviceDeregistered,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.deviceId,
          tenantId: msg.tenantId,
          status: "deregistered",
          previousStatus: device.status,
          reason: p.reason,
        },
      });
    });

    // Post-commit: revoke all cached credentials (best-effort)
    try {
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, p.deviceId));
      if (tokenHashToRevoke) {
        await cache.invalidate(cache.makeKey("__device_auth__", "token_hash", tokenHashToRevoke));
      }
      if (certFingerprint) {
        await cache.invalidate(cache.makeKey("__device_auth__", "certificate_fingerprint", certFingerprint));
      }
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, deviceId: p.deviceId, event: "cache_invalidate_failed" },
        "device cache invalidation failed after deregister");
    }
  });

  // ─── deviceRotateCredential ─────────────────────────────────────────
  queue.subscribe<DeviceRotateCredentialPayload>(COMMANDS.deviceRotateCredential, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const rows = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.id, p.deviceId), eq(devices.tenantId, msg.tenantId)))
        .limit(1);
      const device = rows[0];
      if (!device) {
        throw new Error(`device '${p.deviceId}' not found for tenant '${msg.tenantId}'`);
      }

      // Generate new token
      const { token: newToken, hash: newHash } = generateDeviceToken();

      await versionedUpdate(tx, devices, {
        id: p.deviceId,
        tenantId: msg.tenantId,
        expectedVersion: device.version,
        set: {
          oldTokenHash: device.deviceTokenHash,
          deviceTokenHash: newHash,
          tokenRotatedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        },
        entity: "device",
      });

      // Audit log
      await tx.insert(deviceAuditLog).values({
        tenantId: msg.tenantId,
        deviceId: p.deviceId,
        action: "credential_rotated",
        details: { authType: device.authType },
        actorId: msg.actorId,
      });

      // Outbox: deviceCredentialRotated event
      await enqueue(tx, {
        topic: EVENTS.deviceCredentialRotated,
        eventType: EVENTS.deviceCredentialRotated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.deviceId,
          tenantId: msg.tenantId,
          authType: device.authType,
          // Raw token included for delivery to the device (internal event only)
          token: newToken,
        },
      });
    });

    // Post-commit: invalidate auth cache so the old token lookup refreshes
    try {
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, p.deviceId));
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, deviceId: p.deviceId, event: "cache_invalidate_failed" },
        "device cache invalidation failed after credential rotation");
    }
  });

  // ─── deviceConfigPush ───────────────────────────────────────────────
  queue.subscribe<DeviceConfigPushPayload>(COMMANDS.deviceConfigPush, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const rows = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.id, p.deviceId), eq(devices.tenantId, msg.tenantId)))
        .limit(1);
      const device = rows[0];
      if (!device) {
        throw new Error(`device '${p.deviceId}' not found for tenant '${msg.tenantId}'`);
      }

      const newConfigVersion = device.configVersion + 1;

      // Store config record in device_configs table
      await tx.insert(deviceConfigs).values({
        tenantId: msg.tenantId,
        deviceId: p.deviceId,
        configVersion: newConfigVersion,
        configPayload: p.config as Record<string, unknown> & { [key: string]: unknown },
        deliveryStatus: "pending",
        createdBy: msg.actorId,
      });

      // Update device with pending_config and increment config_version
      await versionedUpdate(tx, devices, {
        id: p.deviceId,
        tenantId: msg.tenantId,
        expectedVersion: device.version,
        set: {
          pendingConfig: p.config,
          configVersion: newConfigVersion,
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        },
        entity: "device",
      });

      // Audit log
      await tx.insert(deviceAuditLog).values({
        tenantId: msg.tenantId,
        deviceId: p.deviceId,
        action: "config_updated",
        details: { configVersion: newConfigVersion },
        actorId: msg.actorId,
      });

      // Outbox: deviceConfigDelivered event
      await enqueue(tx, {
        topic: EVENTS.deviceConfigDelivered,
        eventType: EVENTS.deviceConfigDelivered,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.deviceId,
          tenantId: msg.tenantId,
          configVersion: newConfigVersion,
        },
      });
    });

    try {
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, p.deviceId));
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, deviceId: p.deviceId, event: "cache_invalidate_failed" },
        "device cache invalidation failed after config push");
    }
  });

  // ─── deviceBulkConfigPush ───────────────────────────────────────────
  queue.subscribe<DeviceBulkConfigPushPayload>(COMMANDS.deviceBulkConfigPush, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Query all matching devices by type + location
      const matchingDevices = await tx
        .select()
        .from(devices)
        .where(
          and(
            eq(devices.tenantId, msg.tenantId),
            eq(devices.deviceType, p.deviceType),
            eq(devices.locationId, p.locationId),
            eq(devices.status, "active"),
          ),
        );

      if (matchingDevices.length === 0) {
        log.info({ tenantId: msg.tenantId, deviceType: p.deviceType, locationId: p.locationId, event: "bulk_config_no_devices" },
          "no active devices found matching bulk config push criteria");
        return;
      }

      // Create config records and update each device (ordered by id to prevent deadlocks)
      const sortedDevices = matchingDevices.sort((a, b) => a.id.localeCompare(b.id));

      for (const device of sortedDevices) {
        const newConfigVersion = device.configVersion + 1;

        await tx.insert(deviceConfigs).values({
          tenantId: msg.tenantId,
          deviceId: device.id,
          configVersion: newConfigVersion,
          configPayload: p.config as Record<string, unknown> & { [key: string]: unknown },
          deliveryStatus: "pending",
          createdBy: msg.actorId,
        });

        await versionedUpdate(tx, devices, {
          id: device.id,
          tenantId: msg.tenantId,
          expectedVersion: device.version,
          set: {
            pendingConfig: p.config,
            configVersion: newConfigVersion,
            updatedAt: new Date(),
            updatedBy: msg.actorId,
          },
          entity: "device",
        });
      }
    });

    // Post-commit: invalidate cache for all affected devices (best-effort)
    // We re-query to get the device ids (not inside the tx to avoid holding connection)
    try {
      // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
      // before this read — a bare db.select() runs with no RLS GUC set.
      const affected = await db.transaction((tx) =>
        tx
          .select({ id: devices.id })
          .from(devices)
          .where(
            and(
              eq(devices.tenantId, msg.tenantId),
              eq(devices.deviceType, p.deviceType),
              eq(devices.locationId, p.locationId),
            ),
          ),
      );
      for (const d of affected) {
        await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, d.id));
      }
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, deviceType: p.deviceType, event: "cache_invalidate_failed" },
        "device cache invalidation failed after bulk config push");
    }
  });

  // ─── deviceHeartbeat ────────────────────────────────────────────────
  queue.subscribe<DeviceHeartbeatPayload>(COMMANDS.deviceHeartbeat, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const now = new Date(p.lastSeenAt);
      await tx.update(devices).set({
        lastSeenAt: now,
        firmwareVersion: p.firmwareVersion,
        online: true,
        updatedAt: now,
      }).where(and(eq(devices.id, p.deviceId), eq(devices.tenantId, msg.tenantId)));
    });
    try {
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, p.deviceId));
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, deviceId: p.deviceId, event: "cache_invalidate_failed" },
        "device cache invalidation failed after heartbeat");
    }
  });

  // ─── deviceFirmwareSchedule ─────────────────────────────────────────
  queue.subscribe<DeviceFirmwareSchedulePayload>(COMMANDS.deviceFirmwareSchedule, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const rows = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.id, p.deviceId), eq(devices.tenantId, msg.tenantId)))
        .limit(1);
      const device = rows[0];
      if (!device) {
        throw new Error(`device '${p.deviceId}' not found for tenant '${msg.tenantId}'`);
      }

      // Set firmware URL and checksum in pending_config for delivery via heartbeat
      const currentPendingConfig = (device.pendingConfig ?? {}) as Record<string, unknown>;
      const updatedConfig = {
        ...currentPendingConfig,
        firmwareUrl: p.firmwareUrl,
        firmwareChecksum: p.firmwareChecksum,
      };

      await versionedUpdate(tx, devices, {
        id: p.deviceId,
        tenantId: msg.tenantId,
        expectedVersion: device.version,
        set: {
          pendingConfig: updatedConfig,
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        },
        entity: "device",
      });

      // Audit log
      await tx.insert(deviceAuditLog).values({
        tenantId: msg.tenantId,
        deviceId: p.deviceId,
        action: "firmware_flagged",
        details: { firmwareUrl: p.firmwareUrl, firmwareChecksum: p.firmwareChecksum },
        actorId: msg.actorId,
      });
    });

    try {
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, p.deviceId));
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, deviceId: p.deviceId, event: "cache_invalidate_failed" },
        "device cache invalidation failed after firmware schedule");
    }
  });
}
