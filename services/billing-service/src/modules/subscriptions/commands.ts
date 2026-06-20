import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createSubscription(ctx: RequestContext, tenantId: string, planId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.subscriptionCreate, {
    messageId: id, type: COMMANDS.subscriptionCreate, tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId, planId },
  });
  await cache.invalidate(cache.makeKey(tenantId, "subscription", tenantId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function activateSubscription(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.subscriptionActivate, {
    type: COMMANDS.subscriptionActivate, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function cancelSubscription(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.subscriptionCancel, {
    type: COMMANDS.subscriptionCancel, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
