import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { Platform } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface RegisterSubscriptionPayload {
  userId: string;
  platform: Platform;
  deviceToken: string;
  endpoint?: string | undefined;
  userAgent?: string | undefined;
}

export interface CreateInAppMessagePayload {
  userId: string;
  title: string;
  body: string;
  severity?: "info" | "warning" | "action_required" | undefined;
  actionUrl?: string | undefined;
}

export async function registerSubscription(
  ctx: RequestContext, payload: RegisterSubscriptionPayload,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.registerPushSubscription, {
    messageId: id, type: COMMANDS.registerPushSubscription, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function revokeSubscription(ctx: RequestContext, subscriptionId: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.revokePushSubscription, {
    messageId, type: COMMANDS.revokePushSubscription, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: subscriptionId, tenantId: ctx.tenantId },
  });
  return { id: subscriptionId, status: "accepted", correlationId: ctx.correlationId };
}

export async function createInAppMessage(
  ctx: RequestContext, payload: CreateInAppMessagePayload,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createInAppMessage, {
    messageId: id, type: COMMANDS.createInAppMessage, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function markInAppRead(
  ctx: RequestContext, messageId: string, userId: string,
): Promise<Accepted> {
  const envelopeId = randomUUID();
  await queue.publish(COMMANDS.markInAppRead, {
    messageId: envelopeId, type: COMMANDS.markInAppRead, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: messageId, tenantId: ctx.tenantId, userId },
  });
  return { id: messageId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Push send. Deliberately routed through the existing `notification.send`
 * command with `channel: "push"` rather than a parallel send path, so the
 * delivery consumer applies the SAME preference/opt-out, DND and suppression
 * checks it applies to every other channel. A dedicated push send path would be
 * a way to bypass consent, which is exactly what must not exist.
 */
export async function sendPush(
  ctx: RequestContext,
  payload: { userId: string; templateId?: string | undefined; subject?: string | undefined; body: string; eventType?: string | undefined },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.sendNotification, {
    messageId: id, type: COMMANDS.sendNotification, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      // No deliveryId: the delivery consumer treats a present deliveryId as
      // "update the existing row", so passing one here would update nothing.
      channel: "push",
      recipientId: payload.userId,
      recipient: payload.userId,
      body: payload.body,
      ...(payload.templateId !== undefined ? { templateId: payload.templateId } : {}),
      ...(payload.subject !== undefined ? { subject: payload.subject } : {}),
      ...(payload.eventType !== undefined ? { eventType: payload.eventType } : {}),
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
