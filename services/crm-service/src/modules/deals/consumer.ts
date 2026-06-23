import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as contactRepo from "../contacts/repo.js";
import type { DealView } from "./schema.js";

const RESOURCE = "deal";
const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerDealConsumers(queue: Queue): void {
  queue.subscribe<DealView>(COMMANDS.createDeal, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name, stage: p.stage,
        valueMinor: BigInt(p.valueMinor), currency: p.currency,
        contactId: p.contactId, ownerId: p.ownerId,
        closeDate: p.closeDate, probability: p.probability,
        status: p.status, createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
      });
      if (p.contactId) await contactRepo.touchLastActivity(tx, p.contactId, p.tenantId);
      await emit(tx, msg, EVENTS.dealCreated, { dealId: p.id, name: p.name, contactId: p.contactId }, "create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe(COMMANDS.updateDealStage, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; stage: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateStage(tx, p.id, p.tenantId, p.stage, msg.actorId);
      await emit(tx, msg, EVENTS.dealStageUpdated, { dealId: p.id, stage: p.stage }, "update_stage", p.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, p.id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
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
    topic: eventType, eventType,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "crm", action, resourceType: "deal", resourceId, outcome: "success" },
  });
}
