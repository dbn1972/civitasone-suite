import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "ai.protocols.consumer" });
const AUDIT_TOPIC = "audit.event.record";

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, roles: [] as string[] };
}

export function registerProtocolConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.registerProtocol, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; protocol: string; endpoint: string;
      capabilities: Record<string, unknown>[]; enabled: boolean;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id, tenantId: p.tenantId, protocol: p.protocol, endpoint: p.endpoint,
        capabilities: p.capabilities as never, enabled: p.enabled,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.protocolRegistered, eventType: EVENTS.protocolRegistered,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { registrationId: p.id, protocol: p.protocol },
      });
      await writeAudit(tx, ctxOf(msg) as never, {
        action: "protocol.register", input: p.protocol, output: p.id, blocked: false, reason: null,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "ai-agent-service", action: "protocol_register", resourceType: "protocol", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidateResource(msg.tenantId, "protocols");
    log.info({ id: p.id }, "protocol registered");
  });

  queue.subscribe(COMMANDS.updateProtocol, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; version: number;
      patch: Record<string, unknown>; enabled?: boolean;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findById(p.id, msg.tenantId);
      if (!existing) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { ...p.patch, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.protocolUpdated, eventType: EVENTS.protocolUpdated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          registrationId: p.id, protocol: existing.protocol,
          enabled: p.enabled ?? existing.enabled,
        },
      });
      await writeAudit(tx, ctxOf(msg) as never, {
        action: "protocol.update", input: JSON.stringify(Object.keys(p.patch)),
        output: null, blocked: false, reason: null,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "ai-agent-service", action: "protocol_update", resourceType: "protocol", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidateResource(msg.tenantId, "protocols");
  });
}
