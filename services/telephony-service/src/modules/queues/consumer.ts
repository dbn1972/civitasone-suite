/** queues consumer — only writer for the queue aggregate. */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, QUEUE_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { createQueuePayload } from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerQueueConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.createQueue, async (msg) => {
    const parsed = createQueuePayload.safeParse(msg.payload);
    if (!parsed.success) throw new Error(`invalid createQueue payload: ${parsed.error.message}`);
    const p = parsed.data;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        description: p.description,
        slaAnswerSeconds: p.slaAnswerSeconds,
        status: "active",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.queueCreated, { queueId: p.id, name: p.name }, "create_queue", p.id);
    });
    await cache.invalidateResource(msg.tenantId, QUEUE_RESOURCE);
  });
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType,
    eventType,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "telephony", action, resourceType: "queue", resourceId, outcome: "success" },
  });
}
