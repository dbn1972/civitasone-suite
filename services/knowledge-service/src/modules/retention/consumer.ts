import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { RetentionPolicyView } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "retention-policy";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerRetentionConsumers(queue: Queue): void {
  queue.subscribe<RetentionPolicyView>(COMMANDS.retentionPolicyCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        categoryId: p.categoryId,
        retentionYears: p.retentionYears,
        retentionDays: p.retentionDays,
        action: p.action,
        notifyBefore: p.notifyBefore,
        reminderMonths: p.reminderMonths,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.retentionPolicyCreated, { policyId: p.id, name: p.name }, "create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe(COMMANDS.retentionPolicyUpdate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload as { id: string } & Record<string, unknown>;
      await repo.update(tx, p.id, { ...p, updatedBy: msg.actorId, updatedAt: new Date() } as never);
      await emit(tx, msg, EVENTS.retentionPolicyUpdated, { policyId: p.id }, "update", p.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, (msg.payload as { id: string }).id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe(COMMANDS.retentionPolicyApply, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload as { policyId: string; tenantId: string };
      await emit(tx, msg, EVENTS.retentionPolicyApplied, { policyId: p.policyId }, "apply", p.policyId);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string
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
    payload: { service: "knowledge", action, resourceType: "retention-policy", resourceId, outcome: "success" },
  });
}
