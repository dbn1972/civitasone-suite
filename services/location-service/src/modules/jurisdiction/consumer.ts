import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCES } from "../../topics.js";
import * as repo from "./repo.js";
import type { JurisdictionView } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCES.jurisdiction, id);
}

export function registerJurisdictionConsumers(queue: Queue): void {
  queue.subscribe<JurisdictionView>(COMMANDS.jurisdictionAssign, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        officeId: p.officeId,
        unitId: p.unitId,
        level: p.level,
        isPrimary: p.isPrimary,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.jurisdictionAssigned, { jurisdictionId: p.id, officeId: p.officeId, unitId: p.unitId }, "assign", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCES.jurisdiction);
  });

  queue.subscribe<{ id: string }>(COMMANDS.jurisdictionRevoke, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.remove(tx, msg.payload.id, msg.tenantId);
      await emit(tx, msg, EVENTS.jurisdictionRevoked, { jurisdictionId: msg.payload.id }, "revoke", msg.payload.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, msg.payload.id));
    await cache.invalidateResource(msg.tenantId, RESOURCES.jurisdiction);
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
    payload: { service: "location", action, resourceType: "jurisdiction", resourceId, outcome: "success" },
  });
}
