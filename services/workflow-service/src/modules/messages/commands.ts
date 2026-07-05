import type { RequestContext } from "@civitasone/types";
import { randomUUID } from "node:crypto";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, TASK_RESOURCE } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { assertValidMessageName, assertValidSignalName, assertValidCorrelationKey } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * Deliver a correlated message. Finds the ONE active subscription matching
 * (tenantId, messageName, correlationKey) and publishes a command to the
 * consumer that will: mark it matched, auto-complete the waiting task, and
 * advance the instance along the message node's outgoing edge.
 *
 * If no active subscription matches, returns 404 (the instance hasn't yet
 * reached the message catch event, or the message was already delivered).
 */
export async function deliverMessage(
  ctx: RequestContext,
  messageName: string,
  correlationKey: string,
  payload: Record<string, unknown>,
): Promise<Accepted> {
  assertValidMessageName(messageName);
  assertValidCorrelationKey(correlationKey);

  const sub = await repo.findActiveMessageSubscription(ctx.tenantId, messageName, correlationKey);
  if (!sub) {
    throw new HttpError(404, "NO_SUBSCRIPTION", `no active subscription for message '${messageName}' with key '${correlationKey}'`);
  }

  const correlationId = ctx.correlationId ?? randomUUID();

  await queue.publish(COMMANDS.deliverMessage, {
    messageId: randomUUID(),
    type: COMMANDS.deliverMessage,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId,
    schemaVersion: "1.0",
    payload: {
      subscriptionId: sub.id,
      instanceId: sub.instanceId,
      taskId: sub.taskId,
      nodeKey: sub.nodeKey,
      messageName,
      correlationKey,
      messagePayload: payload,
    },
  });

  await cache.invalidateResource(ctx.tenantId, TASK_RESOURCE);

  return { id: sub.id, status: "accepted", correlationId };
}

/**
 * Broadcast a signal. Finds ALL active signal subscriptions for (tenantId,
 * signalName) and publishes a command for each. Signals are fan-out: every
 * waiting instance receives the signal independently.
 *
 * Returns the count of matched subscriptions. 0 is valid (no one listening).
 */
export async function broadcastSignal(
  ctx: RequestContext,
  signalName: string,
  payload: Record<string, unknown>,
): Promise<{ matched: number; status: string; correlationId: string }> {
  assertValidSignalName(signalName);

  const subs = await repo.findActiveSignalSubscriptions(ctx.tenantId, signalName);
  const correlationId = ctx.correlationId ?? randomUUID();

  for (const sub of subs) {
    await queue.publish(COMMANDS.broadcastSignal, {
      messageId: randomUUID(),
      type: COMMANDS.broadcastSignal,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId,
      schemaVersion: "1.0",
      payload: {
        subscriptionId: sub.id,
        instanceId: sub.instanceId,
        taskId: sub.taskId,
        nodeKey: sub.nodeKey,
        signalName,
        signalPayload: payload,
      },
    });
  }

  if (subs.length > 0) {
    await cache.invalidateResource(ctx.tenantId, TASK_RESOURCE);
  }

  return { matched: subs.length, status: "accepted", correlationId };
}
