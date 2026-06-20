import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, INSTANCE_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import * as taskRepo from "../tasks/repo.js";
import type { CreateInstancePayload } from "./commands.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerInstancesConsumers(queue: Queue): void {
  queue.subscribe<CreateInstancePayload>(COMMANDS.createInstance, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        status: p.status,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      const taskId = randomUUID();
      await taskRepo.insert(tx, {
        id: taskId,
        tenantId: p.tenantId,
        instanceId: p.id,
        name: p.initialTaskName,
        status: "pending",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.instanceCreated, { instanceId: p.id, name: p.name, taskId }, "create", p.id);
    });
    const view = { id: msg.payload.id, tenantId: msg.payload.tenantId, name: msg.payload.name, status: msg.payload.status, version: msg.payload.version };
    await cache.put(cache.makeKey(msg.tenantId, INSTANCE_RESOURCE, msg.payload.id), view);
    await cache.invalidateResource(msg.tenantId, INSTANCE_RESOURCE);
  });
}

async function emit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow", action, resourceType: "instance", resourceId, outcome: "success" } });
}
