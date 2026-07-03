import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { PluginHookView } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "hook";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerHookConsumers(queue: Queue): void {
  queue.subscribe<PluginHookView>(COMMANDS.hookRegister, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        pluginId: p.pluginId,
        eventType: p.eventType,
        handlerPath: p.handlerPath,
        active: p.active,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.hookRegistered, { hookId: p.id, pluginId: p.pluginId, eventType: p.eventType }, "register", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe<{ hookId: string; tenantId: string }>(COMMANDS.hookDeregister, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.deactivate(tx, msg.payload.hookId, msg.actorId);
      await emit(tx, msg, EVENTS.hookDeregistered, { hookId: msg.payload.hookId }, "deregister", msg.payload.hookId);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}

async function emit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "plugins", action, resourceType: "hook", resourceId, outcome: "success" } });
}
