import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "hrms.device-trust.consumer" });
const AUDIT = "audit.event.record";

export function registerDeviceTrustConsumers(queue: Queue): void {
  queue.subscribe("hrms.device_trust.block", async (msg) => {
    const p = msg.payload as { deviceId: string; tenantId: string; userId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.device_trust.blocked",
        eventType: "hrms.device_trust.blocked",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { deviceId: p.deviceId, userId: p.userId, reason: p.reason },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "device_block", resourceType: "device", resourceId: p.deviceId, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:device_trust:*`);
    log.info({ id: msg.messageId, deviceId: p.deviceId }, "Processed device_trust.block");
  });

  queue.subscribe("hrms.device_trust.unblock", async (msg) => {
    const p = msg.payload as { deviceId: string; tenantId: string; userId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.device_trust.unblocked",
        eventType: "hrms.device_trust.unblocked",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { deviceId: p.deviceId, userId: p.userId },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "device_unblock", resourceType: "device", resourceId: p.deviceId, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:device_trust:*`);
    log.info({ id: msg.messageId, deviceId: p.deviceId }, "Processed device_trust.unblock");
  });

  queue.subscribe("hrms.device_trust.policy_update", async (msg) => {
    const p = msg.payload as { tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.device_trust.policy_updated",
        eventType: "hrms.device_trust.policy_updated",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { tenantId: p.tenantId },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "device_policy_update", resourceType: "device_policy", resourceId: msg.messageId, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:device_trust:*`);
    log.info({ id: msg.messageId }, "Processed device_trust.policy_update");
  });
}
