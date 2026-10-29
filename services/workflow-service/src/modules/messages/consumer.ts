import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { enqueue, markProcessed, stableUuid } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { MessageSubscriptionRow } from "./schema.js";
import * as historyRepo from "../history/repo.js";
import { subscribeWithDlq } from "../dlq/wrap.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { pino } from "pino";

const log = pino({ name: "workflow-messages-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-0000000000a1";

interface CorrelatePayload {
  tenantId?: string;
  messageName: string;
  correlationKey: string;
  payload?: Record<string, unknown>;
}

/** Shape published by messages/commands.ts deliverMessage. */
interface DeliverPayload {
  tenantId?: string;
  subscriptionId: string;
  instanceId?: string;
  taskId?: string;
  nodeKey?: string | null;
  messageName?: string;
  correlationKey?: string;
  messagePayload?: Record<string, unknown>;
}

/**
 * messages/commands.ts broadcastSignal fans out ONE command per matched
 * subscription ({subscriptionId, instanceId, taskId, nodeKey, signalName,
 * signalPayload}) with the tenant on the envelope only. The legacy shape
 * ({tenantId, signalName}) is still accepted and matches every subscriber.
 */
interface SignalPayload {
  tenantId?: string;
  signalName: string;
  subscriptionId?: string;
  signalPayload?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

type ConsumerTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Match ONE active message subscription: CAS it to matched, merge the payload
 * into the instance context, enqueue the completeTask that resumes the
 * instance, and record history/audit/domain events. Shared by
 * workflow.message.correlate (lookup by name+key) and workflow.message.deliver
 * (subscription already resolved by the HTTP command). Returns false when the
 * subscription is no longer active (expired/matched concurrently).
 */
async function applyMessageMatch(
  tx: ConsumerTx,
  msg: { correlationId?: string },
  tenantId: string,
  subscription: MessageSubscriptionRow,
  messageName: string,
  correlationKey: string,
  messagePayload: Record<string, unknown>,
): Promise<boolean> {
  // Mark the subscription as matched
  // (compare-and-set: skip if the timeout sweeper expired it since our lookup)
  if (!(await repo.markMessageMatched(tx, subscription.id, messagePayload))) {
    log.warn({ subscriptionId: subscription.id }, "message subscription no longer active; skipping correlation");
    return false;
  }

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

  // Domain event: message received
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: EVENTS.messageReceived,
    eventType: EVENTS.messageReceived,
    tenantId,
    actorId: SYSTEM_ACTOR_ID,
    correlationId,
    payload: {
      subscriptionId: subscription.id,
      instanceId: subscription.instanceId,
      taskId: subscription.taskId,
      messageName,
      correlationKey,
    },
  });
  return true;
}

/**
 * The tenant comes from the authenticated message ENVELOPE (as in every other
 * workflow consumer; tenantScoped() already runs the handler under it). A
 * payload copy of the tenant is informational only: when present and
 * different, the message is dropped rather than acted on cross-tenant.
 */
function envelopeTenant(msg: { tenantId: string; messageId: string; type?: string }, payloadTenant: string | undefined): string | null {
  if (payloadTenant && payloadTenant !== msg.tenantId) {
    log.warn(
      { messageId: msg.messageId, topic: msg.type, envelopeTenant: msg.tenantId, payloadTenant },
      "payload tenant differs from envelope tenant; dropping message",
    );
    return null;
  }
  return msg.tenantId;
}

export function registerMessagesConsumers(q: Queue): void {
  // RLS (#146): run every handler inside the message's tenant context so
  // db.transaction() sets the app.tenant_id GUC (workflow_svc is NOBYPASSRLS).
  q = tenantScoped(q);

  // --- workflow.message.deliver ---
  // Producer: messages/commands.ts deliverMessage, which has ALREADY resolved
  // the one active subscription and sends {subscriptionId, instanceId, taskId,
  // nodeKey, messageName, correlationKey, messagePayload} with the tenant on
  // the envelope. This handler used to expect {tenantId, recipientInstanceId}
  // in the payload: tenantId was undefined, the outbox insert hit NOT NULL,
  // the command dead-lettered, and the waiting instance never resumed
  // (UAT FQ12 #160). It now performs the actual match.
  subscribeWithDlq<DeliverPayload>(q, COMMANDS.deliverMessage, async (msg) => {
    const p = msg.payload;
    const tenantId = envelopeTenant(msg, p.tenantId);
    if (!tenantId) return;
    let matched = false;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const subscription = await repo.findActiveMessageSubscriptionById(tx, p.subscriptionId);
      if (!subscription || subscription.tenantId !== tenantId) {
        log.warn({ tenantId, subscriptionId: p.subscriptionId }, "message deliver: subscription no longer active; nothing to resume");
        return;
      }
      const messageName = p.messageName ?? subscription.messageName;
      const correlationKey = p.correlationKey ?? subscription.correlationKey;
      if (!(await applyMessageMatch(tx, msg, tenantId, subscription, messageName, correlationKey, p.messagePayload ?? {}))) return;
      matched = true;

      const correlationId = msg.correlationId ?? randomUUID();
      // Domain event: message delivered
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.messageDelivered,
        eventType: EVENTS.messageDelivered,
        tenantId,
        actorId: msg.actorId ?? SYSTEM_ACTOR_ID,
        correlationId,
        payload: {
          messageName,
          subscriptionId: subscription.id,
          recipientInstanceId: subscription.instanceId,
          payload: p.messagePayload ?? {},
        },
      });
    });

    log.info({ tenantId, subscriptionId: p.subscriptionId, matched }, "message deliver processed");
  });

  // --- workflow.message.correlate ---
  subscribeWithDlq<CorrelatePayload>(q, "workflow.message.correlate", async (msg) => {
    const { messageName, correlationKey, payload } = msg.payload;
    const tenantId = envelopeTenant(msg, msg.payload.tenantId);
    if (!tenantId) return;

    const subscription = await repo.findActiveMessageSubscription(tenantId, messageName, correlationKey);
    if (!subscription) {
      log.warn({ tenantId, messageName, correlationKey }, "no active subscription found for message correlation");
      return;
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await applyMessageMatch(tx, msg, tenantId, subscription, messageName, correlationKey, payload ?? {});
    });

    log.info({ tenantId, messageName, correlationKey, subscriptionId: subscription.id }, "message correlated to waiting instance");
  });

  // --- workflow.signal.broadcast ---
  subscribeWithDlq<SignalPayload>(q, "workflow.signal.broadcast", async (msg) => {
    const { signalName, subscriptionId } = msg.payload;
    // tenantId was read from the payload only; the HTTP producer never put it
    // there, so the lookup bound `undefined` (UNDEFINED_VALUE) and every
    // broadcast dead-lettered (UAT FQ12 #161). It now comes from the envelope.
    const tenantId = envelopeTenant(msg, msg.payload.tenantId);
    if (!tenantId) return;

    const active = await repo.findActiveSignalSubscriptions(tenantId, signalName);
    // A per-subscription command must only resume ITS subscriber; otherwise N
    // fan-out commands would each try to resume all N subscribers.
    const subscriptions = subscriptionId ? active.filter((s) => s.id === subscriptionId) : active;
    if (subscriptions.length === 0) {
      log.info({ tenantId, signalName }, "no active signal subscriptions found");
      return;
    }

    for (const sub of subscriptions) {
      await db.transaction(async (tx) => {
        // Use a unique messageId per subscription to avoid dedup collisions
        const dedupId = stableUuid(`${msg.messageId}:${sub.id}`); // uuid column: fold the composite key
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

        // Domain event: signal received
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.signalReceived,
          eventType: EVENTS.signalReceived,
          tenantId,
          actorId: SYSTEM_ACTOR_ID,
          correlationId,
          payload: {
            subscriptionId: sub.id,
            instanceId: sub.instanceId,
            taskId: sub.taskId,
            signalName,
          },
        });
      });
    }

    log.info({ tenantId, signalName, count: subscriptions.length }, "signal broadcast completed");

    // Emit signalDelivered event after all subscriptions processed
    if (subscriptions.length > 0) {
      await db.transaction(async (tx) => {
        const correlationId = msg.correlationId ?? randomUUID();
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.signalDelivered,
          eventType: EVENTS.signalDelivered,
          tenantId,
          actorId: msg.actorId ?? SYSTEM_ACTOR_ID,
          correlationId,
          payload: {
            signalName,
            subscriberCount: subscriptions.length,
          },
        });
      });
    }
  });
}
