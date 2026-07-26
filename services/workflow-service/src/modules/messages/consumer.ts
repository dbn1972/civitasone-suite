import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import * as historyRepo from "../history/repo.js";
import { subscribeWithDlq } from "../dlq/wrap.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { pino } from "pino";

const log = pino({ name: "workflow-messages-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-0000000000a1";

interface CorrelatePayload {
  tenantId: string;
  messageName: string;
  correlationKey: string;
  payload?: Record<string, unknown>;
}

interface SignalPayload {
  tenantId: string;
  signalName: string;
  payload?: Record<string, unknown>;
}

export function registerMessagesConsumers(q: Queue): void {
  // RLS (#146): run every handler inside the message's tenant context so
  // db.transaction() sets the app.tenant_id GUC (workflow_svc is NOBYPASSRLS).
  q = tenantScoped(q);
  // --- workflow.message.correlate ---
  subscribeWithDlq<CorrelatePayload>(q, "workflow.message.correlate", async (msg) => {
    const { tenantId, messageName, correlationKey, payload } = msg.payload;

    const subscription = await repo.findActiveMessageSubscription(tenantId, messageName, correlationKey);
    if (!subscription) {
      log.warn({ tenantId, messageName, correlationKey }, "no active subscription found for message correlation");
      return;
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const messagePayload = payload ?? {};

      // Mark the subscription as matched
      await repo.markMessageMatched(tx, subscription.id, messagePayload);

      // Merge payload into instance context
      if (Object.keys(messagePayload).length > 0) {
        await (tx as unknown as { execute(query: ReturnType<typeof sql>): Promise<unknown> }).execute(
          sql`UPDATE workflow.instances SET context = context || ${JSON.stringify(messagePayload)}::jsonb WHERE id = ${subscription.instanceId}`,
        );
      }

      // Publish completeTask command for the waiting task
      const correlationId = msg.correlationId ?? randomUUID();
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: COMMANDS.completeTask,
        eventType: COMMANDS.completeTask,
        tenantId,
        actorId: SYSTEM_ACTOR_ID,
        correlationId,
        payload: {
          id: subscription.taskId,
          tenantId,
          instanceId: subscription.instanceId,
          name: `Message: ${messageName}`,
          status: "pending",
          roleRef: null,
          nodeKey: subscription.nodeKey,
          decision: "approve",
          sodOverride: true,
        },
      });

      // Record in transition_history
      await historyRepo.record(tx, {
        tenantId,
        instanceId: subscription.instanceId,
        taskId: subscription.taskId,
        fromNode: subscription.nodeKey,
        toNode: subscription.nodeKey,
        action: "message_received",
        decision: null,
        actorId: SYSTEM_ACTOR_ID,
        detail: { messageName, correlationKey },
      });

      // Audit event
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId,
        actorId: SYSTEM_ACTOR_ID,
        correlationId,
        payload: {
          service: "workflow",
          action: "message_received",
          resourceType: "message_subscription",
          resourceId: subscription.id,
          outcome: "success",
        },
      });
    });

    log.info({ tenantId, messageName, correlationKey, subscriptionId: subscription.id }, "message correlated to waiting instance");
  });

  // --- workflow.signal.broadcast ---
  subscribeWithDlq<SignalPayload>(q, "workflow.signal.broadcast", async (msg) => {
    const { tenantId, signalName, payload } = msg.payload;

    const subscriptions = await repo.findActiveSignalSubscriptions(tenantId, signalName);
    if (subscriptions.length === 0) {
      log.info({ tenantId, signalName }, "no active signal subscriptions found");
      return;
    }

    for (const sub of subscriptions) {
      await db.transaction(async (tx) => {
        // Use a unique messageId per subscription to avoid dedup collisions
        const dedupId = `${msg.messageId}:${sub.id}`;
        if (!(await markProcessed(tx, dedupId))) return;

        // Mark signal as matched
        await repo.markSignalMatched(tx, sub.id);

        // Publish completeTask for the subscription's taskId
        const correlationId = msg.correlationId ?? randomUUID();
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: COMMANDS.completeTask,
          eventType: COMMANDS.completeTask,
          tenantId,
          actorId: SYSTEM_ACTOR_ID,
          correlationId,
          payload: {
            id: sub.taskId,
            tenantId,
            instanceId: sub.instanceId,
            name: `Signal: ${signalName}`,
            status: "pending",
            roleRef: null,
            nodeKey: sub.nodeKey,
            decision: "approve",
            sodOverride: true,
          },
        });

        // Record in transition_history
        await historyRepo.record(tx, {
          tenantId,
          instanceId: sub.instanceId,
          taskId: sub.taskId,
          fromNode: sub.nodeKey,
          toNode: sub.nodeKey,
          action: "signal_received",
          decision: null,
          actorId: SYSTEM_ACTOR_ID,
          detail: { signalName },
        });

        // Audit event
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId,
          actorId: SYSTEM_ACTOR_ID,
          correlationId,
          payload: {
            service: "workflow",
            action: "signal_received",
            resourceType: "signal_subscription",
            resourceId: sub.id,
            outcome: "success",
          },
        });
      });
    }

    log.info({ tenantId, signalName, count: subscriptions.length }, "signal broadcast completed");
  });
}
