import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { UpsertBrandingPayload } from "./commands.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "branding";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerBrandingConsumers(queue: Queue): void {
  queue.subscribe<UpsertBrandingPayload>(COMMANDS.upsertBranding, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { projected, isCreate } = msg.payload;
      if (isCreate) {
        await repo.insert(tx, projected);
      } else {
        const { tenantId, ...patch } = projected;
        await repo.update(tx, tenantId, patch);
      }
      await emit(tx, msg, EVENTS.brandingUpserted, { brandingId: projected.id, tenantId: projected.tenantId }, "upsert", projected.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.projected.id), msg.payload.projected);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}

async function emit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "themes", action, resourceType: "branding", resourceId, outcome: "success" } });
}
