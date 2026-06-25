import { randomUUID } from "node:crypto";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { maskRecipient } from "../../adapters/mask.js";
import * as repo from "./repo.js";
import { computeNextRetryAt, shouldRetry } from "./retry.js";
import {
  resolvePreferredChannel,
  resolveChannelWithDefault,
  sendWithFallback,
  CHANNEL_NONE,
} from "./channel.js";
import { notificationTemplates, notificationPrefs } from "../templates/schema.js";
import { eq } from "drizzle-orm";

const AUDIT_TOPIC = "audit.event.record";

type SendPayload = {
  templateId: string;
  recipient: string;
  recipientId?: string;
  channel?: string;
  eventType?: string;
  variables?: Record<string, string>;
  deliveryId?: string;
  retryCount?: number;
};

export function registerDeliveryConsumers(q: Queue): void {
  q.subscribe<SendPayload>(COMMANDS.sendNotification, async (msg) => {
    await processSend(msg);
  });
}

async function processSend(msg: CommandEnvelope<SendPayload>): Promise<void> {
  const p = msg.payload;
  const deliveryId = p.deliveryId ?? randomUUID();
  const retryCount = p.retryCount ?? 0;
  const recipientId = p.recipientId ?? null;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const templateRows = await tx.select().from(notificationTemplates).where(eq(notificationTemplates.id, p.templateId)).limit(1);
    const template = templateRows[0];
    const userId = p.recipientId ?? p.recipient;
    const prefRows = await tx.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId));
    const prefs = prefRows.map((r) => ({
      id: r.id, tenantId: r.tenantId, userId: r.userId, eventType: r.eventType,
      inApp: r.inApp, email: r.email, push: r.push, version: r.version,
    }));

    // P1-1: opt-out is decided from prefs FIRST, using only a CALLER-specified
    // channel (`p.channel`) as an explicit override. The template's default
    // channel must NOT be treated as an override — otherwise every template
    // (which always carries a channel) would silently defeat a recipient's
    // opt-out. The template channel is applied only as a default for a recipient
    // who has NOT opted out and expressed no preference.
    const prefResolution = resolvePreferredChannel(prefs, p.eventType, p.channel);
    const optedOut = prefResolution.optedOut;
    const channel = optedOut
      ? CHANNEL_NONE
      : await resolveChannelWithDefault(msg.tenantId, prefs, p.eventType, p.channel ?? template?.channel);
    const { preferred, fallbacks } = resolvePreferredChannel(prefs, p.eventType, optedOut ? undefined : channel);

    // P1-1: a fully opted-out recipient → record a `skipped` delivery on channel
    // `none` and send nothing. This is terminal (no retry, no fallback to email).
    if (optedOut || channel === CHANNEL_NONE) {
      if (!p.deliveryId) {
        await repo.insertDelivery(tx, {
          id: deliveryId, tenantId: msg.tenantId, templateId: p.templateId,
          recipient: p.recipient, recipientId, channel: CHANNEL_NONE, status: "skipped",
          retryCount, createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
        });
      } else {
        await repo.updateDeliveryStatus(tx, deliveryId, "skipped", msg.actorId, retryCount + 1);
      }
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId,
        actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "send", resourceType: "delivery", resourceId: deliveryId,
          outcome: "skipped", channel: CHANNEL_NONE, reason: "recipient_opted_out",
        },
      });
      return;
    }

    const attemptChannels = [preferred, ...fallbacks];

    if (!p.deliveryId) {
      await repo.insertDelivery(tx, {
        id: deliveryId, tenantId: msg.tenantId, templateId: p.templateId,
        recipient: p.recipient, recipientId, channel: preferred, status: "sending",
        retryCount, createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
      });
    } else {
      await repo.updateDeliveryStatus(tx, deliveryId, "sending", msg.actorId, retryCount + 1);
    }

    const body = template?.body ?? "(no template body)";
    const sendResult = await sendWithFallback(attemptChannels, {
      recipient: p.recipient,
      subject: template?.subject ?? null,
      body,
      tenantId: msg.tenantId,
      userId: p.recipientId ?? p.recipient,
      ...(p.variables ? { variables: p.variables } : {}),
    });

    if (sendResult.error) {
      const nextRetry = retryCount + 1;
      if (shouldRetry(retryCount)) {
        // P1-2: DURABLE retry. Persist status='queued' + next_retry_at and let the
        // DB-backed sweeper (worker.ts) republish once due. No setTimeout — survives
        // a worker restart because the due row is stored in Postgres.
        const nextRetryAt = computeNextRetryAt(retryCount);
        await repo.scheduleDeliveryRetry(tx, deliveryId, nextRetry, nextRetryAt, msg.actorId, sendResult.error);
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.failed, eventType: EVENTS.failed, tenantId: msg.tenantId,
          actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { deliveryId, retryCount: nextRetry, nextRetryAt: nextRetryAt.toISOString(), recipientId, error: sendResult.error },
        });
        return;
      }

      await repo.updateDeliveryStatus(tx, deliveryId, "failed", msg.actorId, nextRetry + 1, undefined, sendResult.error, sendResult.error);
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.permanentlyFailed, eventType: EVENTS.permanentlyFailed, tenantId: msg.tenantId,
        actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          deliveryId, templateId: p.templateId, recipient: p.recipient, recipientId, channel: sendResult.channel,
          retryCount: nextRetry, error: sendResult.error,
        },
      });
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId,
        actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "send", resourceType: "delivery", resourceId: deliveryId,
          outcome: "failure", error: sendResult.error, channel: sendResult.channel,
        },
      });
      return;
    }

    await repo.updateDeliveryStatus(tx, deliveryId, "delivered", msg.actorId, retryCount + 2, new Date(), undefined, undefined, sendResult.channel);
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: EVENTS.delivered, eventType: EVENTS.delivered, tenantId: msg.tenantId,
      actorId: msg.actorId, correlationId: msg.correlationId,
      payload: { deliveryId, templateId: p.templateId, recipient: p.recipient, recipientId, channel: sendResult.channel },
    });
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId,
      actorId: msg.actorId, correlationId: msg.correlationId,
      payload: { service: "notification", action: "send", resourceType: "delivery", resourceId: deliveryId, outcome: "success", recipient: maskRecipient(p.recipient) },
    });
  });
}

/** Exported for tests — same delay schedule as SQS DelaySeconds [900, 3600, 14400]. */
export { computeNextRetryAt, shouldRetry } from "./retry.js";
export { retryDelaySeconds } from "./retry.js";
