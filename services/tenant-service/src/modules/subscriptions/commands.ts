/**
 * Subscription command handlers (WRITE PATH).
 * Validate → publish command → return 202. Consumer does the durable DB write.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  CreateSubscriptionBody,
  UpgradeSubscriptionBody,
  CancelSubscriptionBody,
  RenewSubscriptionBody,
  SuspendSubscriptionBody,
} from "./validators.js";
import type { SubscriptionView } from "./repo.js";

export type Accepted = { id: string; status: string; correlationId: string };

const RESOURCE = "subscription";

export async function subscriptionCreate(ctx: RequestContext, body: CreateSubscriptionBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: SubscriptionView = {
    id,
    tenantId: body.tenantId,
    planId: body.planId,
    status: "trial",
    startDate: new Date(body.startDate),
    endDate: null,
    trialEndsAt: body.trialEndsAt ? new Date(body.trialEndsAt) : null,
    currentPeriodStart: new Date(body.currentPeriodStart),
    currentPeriodEnd: new Date(body.currentPeriodEnd),
    cancelledAt: null,
    cancelReason: null,
    version: 1,
  };
  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);

  await queue.publish(COMMANDS.subscriptionCreate, {
    messageId: id,
    type: COMMANDS.subscriptionCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function subscriptionUpgrade(ctx: RequestContext, subscriptionId: string, body: UpgradeSubscriptionBody): Promise<Accepted> {
  await queue.publish(COMMANDS.subscriptionUpgrade, {
    type: COMMANDS.subscriptionUpgrade,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: subscriptionId, newPlanId: body.newPlanId, effectiveDate: body.effectiveDate ?? null },
  });
  return { id: subscriptionId, status: "accepted", correlationId: ctx.correlationId };
}

export async function subscriptionCancel(ctx: RequestContext, subscriptionId: string, body: CancelSubscriptionBody): Promise<Accepted> {
  await queue.publish(COMMANDS.subscriptionCancel, {
    type: COMMANDS.subscriptionCancel,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: subscriptionId, reason: body.reason, immediate: body.immediate },
  });
  return { id: subscriptionId, status: "accepted", correlationId: ctx.correlationId };
}

export async function subscriptionRenew(ctx: RequestContext, subscriptionId: string, body: RenewSubscriptionBody): Promise<Accepted> {
  await queue.publish(COMMANDS.subscriptionRenew, {
    type: COMMANDS.subscriptionRenew,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: subscriptionId, newPeriodStart: body.newPeriodStart, newPeriodEnd: body.newPeriodEnd },
  });
  return { id: subscriptionId, status: "accepted", correlationId: ctx.correlationId };
}

export async function subscriptionSuspend(ctx: RequestContext, subscriptionId: string, body: SuspendSubscriptionBody): Promise<Accepted> {
  await queue.publish(COMMANDS.subscriptionSuspend, {
    type: COMMANDS.subscriptionSuspend,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: subscriptionId, reason: body.reason },
  });
  return { id: subscriptionId, status: "accepted", correlationId: ctx.correlationId };
}
