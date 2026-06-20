import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, TASK_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { TaskView } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerTasksConsumers(queue: Queue): void {
  queue.subscribe<TaskView>(COMMANDS.completeTask, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const updated = await repo.markCompleted(tx, p.id, p.tenantId, msg.actorId);
      if (!updated) return;
      await emit(tx, msg, EVENTS.taskCompleted, { taskId: p.id, instanceId: p.instanceId }, "complete", p.id);
    });
    await cache.put(cache.makeKey(msg.tenantId, TASK_RESOURCE, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, TASK_RESOURCE);
  });
}

async function emit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow", action, resourceType: "task", resourceId, outcome: "success" } });
}
