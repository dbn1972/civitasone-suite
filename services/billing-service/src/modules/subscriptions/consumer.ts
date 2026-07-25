import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { trialExpiresAt } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerSubscriptionsConsumers(rawQueue: Queue): void {
  // #146 regression fix: run every handler inside the message tenant context so
  // NOBYPASSRLS + FORCE RLS accepts consumer writes (telephony PR #152 pattern).
  const queue = tenantScoped(rawQueue);
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

  // H12 FIX: Wire dunning exhausted event → suspend subscription.
  // Previously this event was published but had NO subscriber, so subscriptions
  // were never suspended after 3 failed payment retries.
  queue.subscribe<{ invoiceId: string; subscriptionId?: string; attempts: number }>(
    EVENTS.dunningExhausted,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const subId = msg.payload.subscriptionId;
        if (!subId) return; // cannot suspend without subscription reference
        await repo.updateStatus(tx, subId, "suspended", "system");
        await enqueue(tx as any, {
          topic: "billing.subscription.suspended",
          eventType: "billing.subscription.suspended",
          tenantId: msg.tenantId,
          actorId: "system",
          correlationId: msg.correlationId,
          payload: { subscriptionId: subId, reason: "dunning_exhausted", attempts: msg.payload.attempts },
        });
        await audit(tx, msg, "subscription_suspend_dunning", subId);
      });
    },
  );
}

async function audit(tx: unknown, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceId: string): Promise<void> {
  const t = tx as any;
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "billing", action, resourceType: "subscription", resourceId, outcome: "success" },
  });
}
