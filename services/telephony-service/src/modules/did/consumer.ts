/** did consumer — only writer for the DID mapping aggregate. */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, DID_RESOURCE, DID_ACTIVE_MAPPINGS_CACHE } from "../../topics.js";
import * as repo from "./repo.js";
import { createDidMappingPayload, deleteDidMappingPayload } from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerDidConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.createDidMapping, async (msg) => {
    const parsed = createDidMappingPayload.safeParse(msg.payload);
    if (!parsed.success) throw new Error(`invalid createDidMapping payload: ${parsed.error.message}`);
    const p = parsed.data;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        didNumber: p.didNumber,
        label: p.label,
        active: p.active,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await emit(tx, msg, EVENTS.didMappingCreated, { didMappingId: p.id, didNumber: p.didNumber }, "create_did_mapping", p.id);
    });
    await cache.invalidate(DID_ACTIVE_MAPPINGS_CACHE);
    await cache.invalidateResource(msg.tenantId, DID_RESOURCE);
  });

  queue.subscribe(COMMANDS.deleteDidMapping, async (msg) => {
    const parsed = deleteDidMappingPayload.safeParse(msg.payload);
    if (!parsed.success) throw new Error(`invalid deleteDidMapping payload: ${parsed.error.message}`);
    const p = parsed.data;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const deleted = await repo.remove(tx, p.id, p.tenantId);
      if (deleted === 0) return void (await emitAudit(tx, msg, "delete_did_mapping", p.id, "rejected_not_found"));
      await emit(tx, msg, EVENTS.didMappingDeleted, { didMappingId: p.id }, "delete_did_mapping", p.id);
    });
    await cache.invalidate(DID_ACTIVE_MAPPINGS_CACHE);
    await cache.invalidate(cache.makeKey(msg.tenantId, DID_RESOURCE, p.id));
    await cache.invalidateResource(msg.tenantId, DID_RESOURCE);
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
    payload: { service: "telephony", action, resourceType: "did_mapping", resourceId, outcome: "success" },
  });
}

async function emitAudit(
  tx: unknown,
  msg: CommandEnvelope,
  action: string,
  resourceId: string,
  outcome: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "telephony", action, resourceType: "did_mapping", resourceId, outcome },
  });
}
