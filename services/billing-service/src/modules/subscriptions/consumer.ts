import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { trialExpiresAt } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerSubscriptionsConsumers(queue: Queue): void {
  queue.subscribe<{ id: string; tenantId: string; planId: string }>(COMMANDS.subscriptionCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const startedAt = new Date();
      await repo.insertSub(tx, {
        id: msg.payload.id, tenantId: msg.payload.tenantId, planId: msg.payload.planId,
        status: "trial", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.insertTrial(tx, {
        tenantId: msg.payload.tenantId, subscriptionId: msg.payload.id,
        startedAt, expiresAt: trialExpiresAt(startedAt),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "subscription_create", msg.payload.id);
    });
    await cache.invalidate(cache.makeKey(msg.payload.tenantId, "subscription", msg.payload.tenantId));
  });

  queue.subscribe<{ id: string }>(COMMANDS.subscriptionActivate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateStatus(tx, msg.payload.id, "active", msg.actorId);
      await audit(tx, msg, "subscription_activate", msg.payload.id);
    });
  });

  queue.subscribe<{ id: string }>(COMMANDS.subscriptionCancel, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateStatus(tx, msg.payload.id, "cancelled", msg.actorId);
      await audit(tx, msg, "subscription_cancel", msg.payload.id);
    });
  });
}

async function audit(tx: unknown, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceId: string): Promise<void> {
  const t = tx as any;
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "billing", action, resourceType: "subscription", resourceId, outcome: "success" },
  });
}
