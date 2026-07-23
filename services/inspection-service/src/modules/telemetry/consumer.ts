/**
 * inspection-service: Telemetry module — command consumers.
 *
 * _Requirements: SVC-110_
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import {
  assertDeviceActive,
  assertValidAlertTransition,
  matchAlertRules,
  DomainError,
  type AlertState,
  type Reading,
  type AlertRule,
} from "./domain.js";
import {
  insertDevice,
  updateDevice,
  findDeviceById,
  insertReading,
  insertAlert,
  updateAlert,
  findAlertById,
  findActiveAlertRules,
} from "./repo.js";
import type {
  DeviceCreatePayload,
  DeviceUpdatePayload,
  ReadingIngestPayload,
  AlertRuleCreatePayload,
  AlertAcknowledgePayload,
  AlertCreateFindingPayload,
} from "./commands.js";
import { insertAlertRule } from "./repo.js";

const log = pino({ name: "telemetry-consumer" });

const AUDIT_TOPIC = "audit.event.record";

export function registerTelemetryConsumers(queue: Queue): void {
  // ─── deviceCreate ─────────────────────────────────────────────────────────
  queue.subscribe<DeviceCreatePayload & { tenantId: string }>(
    COMMANDS.deviceCreate,
    async (msg) => {
      const p = msg.payload;
      let deviceId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const device = await insertDevice(tx, {
          tenantId: msg.tenantId,
          deviceType: p.deviceType,
          deviceIdentifier: p.deviceIdentifier,
          name: p.name,
          entityId: p.entityId ?? null,
          latitude: p.latitude ?? null,
          longitude: p.longitude ?? null,
          status: "active",
          metadata: p.metadata ?? null,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        deviceId = device.id;

        await enqueue(tx, {
          topic: EVENTS.deviceRegistered,
          eventType: EVENTS.deviceRegistered,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            deviceId: device.id,
            deviceType: p.deviceType,
            deviceIdentifier: p.deviceIdentifier,
            name: p.name,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "telemetry.device_registered",
            resourceType: "device",
            resourceId: device.id,
            details: { deviceType: p.deviceType, deviceIdentifier: p.deviceIdentifier },
          },
        });
      });

      if (deviceId) {
        try { await cache.invalidate(cache.makeKey(msg.tenantId, "telemetry-device", deviceId)); }
        catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
      }
    },
  );

  // ─── deviceUpdate ─────────────────────────────────────────────────────────
  queue.subscribe<DeviceUpdatePayload & { tenantId: string }>(
    COMMANDS.deviceUpdate,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const patch: Record<string, unknown> = { updatedBy: msg.actorId };
        if (p.name !== undefined) patch.name = p.name;
        if (p.entityId !== undefined) patch.entityId = p.entityId;
        if (p.latitude !== undefined) patch.latitude = p.latitude;
        if (p.longitude !== undefined) patch.longitude = p.longitude;
        if (p.status !== undefined) patch.status = p.status;
        if (p.metadata !== undefined) patch.metadata = p.metadata;

        await updateDevice(tx, p.deviceId, msg.tenantId, patch, p.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "telemetry.device_updated",
            resourceType: "device",
            resourceId: p.deviceId,
            details: { changedFields: Object.keys(patch) },
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "telemetry-device", p.deviceId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── readingIngest ────────────────────────────────────────────────────────
  queue.subscribe<ReadingIngestPayload & { tenantId: string }>(
    COMMANDS.readingIngest,
    async (msg) => {
      const p = msg.payload;
      let readingId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // Verify device exists and is active
        const device = await findDeviceById(msg.tenantId, p.deviceId);
        if (!device) throw new NonRetryableError(`Device not found: ${p.deviceId}`);

        try {
          assertDeviceActive(device.status);
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        // Insert reading
        const reading = await insertReading(tx, {
          tenantId: msg.tenantId,
          deviceId: p.deviceId,
          readingType: p.readingType,
          value: p.value,
          unit: p.unit,
          latitude: p.latitude ?? null,
          longitude: p.longitude ?? null,
          capturedAt: new Date(p.capturedAt),
          metadata: p.metadata ?? null,
        });

        readingId = reading.id;

        // Update device lastSeenAt
        await updateDevice(tx, p.deviceId, msg.tenantId, {
          lastSeenAt: new Date(p.capturedAt),
          updatedBy: msg.actorId,
        }, device.version);

        // Evaluate alert rules
        const rules = await findActiveAlertRules(msg.tenantId);
        const readingForEval: Reading = {
          value: Number(p.value),
          readingType: p.readingType,
          deviceType: device.deviceType,
        };

        const matchingRules = matchAlertRules(
          readingForEval,
          rules.map((r) => ({
            id: r.id,
            deviceType: r.deviceType,
            readingType: r.readingType,
            operator: r.operator,
            thresholdValue: Number(r.thresholdValue),
            severity: r.severity,
            isActive: r.isActive,
          } satisfies AlertRule)),
        );

        // Create alerts for matching rules
        for (const rule of matchingRules) {
          const alert = await insertAlert(tx, {
            tenantId: msg.tenantId,
            deviceId: p.deviceId,
            readingId: reading.id,
            alertType: "threshold_exceeded",
            severity: rule.severity,
            thresholdValue: String(rule.thresholdValue),
            actualValue: p.value,
            status: "open",
            createdBy: msg.actorId,
            updatedBy: msg.actorId,
          });

          await enqueue(tx, {
            topic: EVENTS.alertTriggered,
            eventType: EVENTS.alertTriggered,
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: {
              alertId: alert.id,
              deviceId: p.deviceId,
              readingId: reading.id,
              alertType: "threshold_exceeded",
              severity: rule.severity,
              thresholdValue: rule.thresholdValue,
              actualValue: Number(p.value),
            },
          });
        }

        await enqueue(tx, {
          topic: EVENTS.readingIngested,
          eventType: EVENTS.readingIngested,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            readingId: reading.id,
            deviceId: p.deviceId,
            readingType: p.readingType,
            value: p.value,
            unit: p.unit,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "telemetry.reading_ingested",
            resourceType: "telemetry_reading",
            resourceId: reading.id,
            details: { deviceId: p.deviceId, readingType: p.readingType },
          },
        });
      });

      if (readingId) {
        try { await cache.invalidate(cache.makeKey(msg.tenantId, "telemetry-device", p.deviceId)); }
        catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
      }
    },
  );

  // ─── alertRuleCreate ──────────────────────────────────────────────────────
  queue.subscribe<AlertRuleCreatePayload & { tenantId: string }>(
    COMMANDS.alertRuleCreate,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const rule = await insertAlertRule(tx, {
          tenantId: msg.tenantId,
          deviceType: p.deviceType,
          readingType: p.readingType,
          operator: p.operator,
          thresholdValue: p.thresholdValue,
          severity: p.severity,
          isActive: true,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        await enqueue(tx, {
          topic: EVENTS.alertRuleCreated,
          eventType: EVENTS.alertRuleCreated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            ruleId: rule.id,
            deviceType: p.deviceType,
            readingType: p.readingType,
            operator: p.operator,
            thresholdValue: p.thresholdValue,
            severity: p.severity,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "telemetry.alert_rule_created",
            resourceType: "alert_rule",
            resourceId: rule.id,
            details: { deviceType: p.deviceType, readingType: p.readingType },
          },
        });
      });
    },
  );

  // ─── alertAcknowledge ─────────────────────────────────────────────────────
  queue.subscribe<AlertAcknowledgePayload & { tenantId: string }>(
    COMMANDS.alertAcknowledge,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const alert = await findAlertById(msg.tenantId, p.alertId);
        if (!alert) throw new NonRetryableError(`Alert not found: ${p.alertId}`);

        try {
          assertValidAlertTransition(alert.status as AlertState, "acknowledged");
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        await updateAlert(tx, p.alertId, msg.tenantId, {
          status: "acknowledged",
          updatedBy: msg.actorId,
        }, alert.version);

        await enqueue(tx, {
          topic: EVENTS.alertAcknowledged,
          eventType: EVENTS.alertAcknowledged,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { alertId: p.alertId, acknowledgedBy: msg.actorId },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "telemetry.alert_acknowledged",
            resourceType: "telemetry_alert",
            resourceId: p.alertId,
            details: {},
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "telemetry-alert", p.alertId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── alertCreateFinding ───────────────────────────────────────────────────
  queue.subscribe<AlertCreateFindingPayload & { tenantId: string }>(
    COMMANDS.alertCreateFinding,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const alert = await findAlertById(msg.tenantId, p.alertId);
        if (!alert) throw new NonRetryableError(`Alert not found: ${p.alertId}`);

        try {
          assertValidAlertTransition(alert.status as AlertState, "finding_created");
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        await updateAlert(tx, p.alertId, msg.tenantId, {
          status: "finding_created",
          updatedBy: msg.actorId,
        }, alert.version);

        await enqueue(tx, {
          topic: EVENTS.alertFindingCreated,
          eventType: EVENTS.alertFindingCreated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            alertId: p.alertId,
            deviceId: alert.deviceId,
            findingDescription: p.findingDescription ?? null,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "telemetry.alert_finding_created",
            resourceType: "telemetry_alert",
            resourceId: p.alertId,
            details: {},
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "telemetry-alert", p.alertId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );
}
