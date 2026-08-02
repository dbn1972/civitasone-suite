/**
 * MT-006 — push subscription + in-app message writes.
 *
 * Secrets: the device token is hashed for the blind index and stored encrypted.
 * Nothing here logs the token or the endpoint — only entity ids.
 *
 * DLQ safety: an unknown subscription/message id, or an endpoint that is not
 * HTTPS, can never succeed on retry → NonRetryableError.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { blindIndex } from "../../shared/pii-crypto.js";
import { isValidWebPushEndpoint, normalizeDeviceToken, PLATFORMS, type Platform } from "./domain.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";
const log = pino({ name: "consumer:push" });

type RegisterPayload = {
  id: string; tenantId: string; userId: string; platform: Platform;
  deviceToken: string; endpoint?: string; userAgent?: string;
};

type InAppPayload = {
  id: string; tenantId: string; userId: string; title: string; body: string;
  severity?: string; actionUrl?: string;
};

export function registerPushConsumers(q: Queue): void {
  q = tenantScoped(q);

  q.subscribe<RegisterPayload>(COMMANDS.registerPushSubscription, async (msg) => {
    const p = msg.payload;
    const token = normalizeDeviceToken(p.deviceToken ?? "");
    if (token.length === 0) {
      throw new NonRetryableError("INVALID_SUBSCRIPTION: deviceToken is required");
    }
    if (!PLATFORMS.includes(p.platform)) {
      throw new NonRetryableError(`INVALID_SUBSCRIPTION: unsupported platform "${String(p.platform)}"`);
    }
    if (p.platform === "web") {
      if (p.endpoint === undefined || !isValidWebPushEndpoint(p.endpoint)) {
        throw new NonRetryableError("INVALID_SUBSCRIPTION: web push requires an https endpoint");
      }
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.upsertSubscription(tx, {
        id: p.id,
        tenantId: p.tenantId,
        userId: p.userId,
        platform: p.platform,
        deviceToken: token,
        endpoint: p.endpoint ?? null,
        tokenHash: blindIndex(token),
        userAgent: p.userAgent ?? null,
        enabled: true,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.pushSubscriptionRegistered,
        eventType: EVENTS.pushSubscriptionRegistered,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { subscriptionId: p.id, userId: p.userId, platform: p.platform },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "register_push_subscription",
          resourceType: "push_subscription", resourceId: p.id, outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(p.tenantId, "push_subscriptions", p.userId));
    log.info({ subscriptionId: p.id, userId: p.userId, platform: p.platform }, "push subscription registered");
  });

  q.subscribe<{ id: string; tenantId: string }>(COMMANDS.revokePushSubscription, async (msg) => {
    const p = msg.payload;
    // Returned from the transaction, not assigned to an outer `let`: TypeScript
    // cannot follow an assignment made inside an async callback and kept the
    // variable narrowed to its initialiser, so the check below did not compile.
    const outcome = await db.transaction(async (tx): Promise<"duplicate" | "revoked" | "missing"> => {
      if (!(await markProcessed(tx, msg.messageId))) return "duplicate";
      const revoked = await repo.revokeSubscription(tx, p.tenantId, p.id, msg.actorId);
      if (!revoked) return "missing";
      await enqueue(tx, {
        topic: EVENTS.pushSubscriptionRevoked,
        eventType: EVENTS.pushSubscriptionRevoked,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { subscriptionId: p.id },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "revoke_push_subscription",
          resourceType: "push_subscription", resourceId: p.id, outcome: "success",
        },
      });
      return "revoked";
    });
    if (outcome === "missing") {
      throw new NonRetryableError(`SUBSCRIPTION_NOT_FOUND: push subscription ${p.id} not found`);
    }
  });

  q.subscribe<InAppPayload>(COMMANDS.createInAppMessage, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertInAppMessage(tx, {
        id: p.id,
        tenantId: p.tenantId,
        userId: p.userId,
        title: p.title,
        body: p.body,
        severity: p.severity ?? "info",
        actionUrl: p.actionUrl ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.inAppMessageCreated,
        eventType: EVENTS.inAppMessageCreated,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { messageId: p.id, userId: p.userId, severity: p.severity ?? "info" },
      });
    });
    await cache.invalidate(cache.makeKey(p.tenantId, "in_app_messages", p.userId));
  });

  q.subscribe<{ id: string; tenantId: string; userId: string }>(COMMANDS.markInAppRead, async (msg) => {
    const p = msg.payload;
    const outcome = await db.transaction(async (tx): Promise<"duplicate" | "read" | "missing"> => {
      if (!(await markProcessed(tx, msg.messageId))) return "duplicate";
      const ok = await repo.markRead(tx, p.tenantId, p.userId, p.id, msg.actorId);
      if (!ok) return "missing";
      await enqueue(tx, {
        topic: EVENTS.inAppMessageRead,
        eventType: EVENTS.inAppMessageRead,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { messageId: p.id, userId: p.userId },
      });
      return "read";
    });
    if (outcome === "missing") {
      throw new NonRetryableError(`IN_APP_MESSAGE_NOT_FOUND: in-app message ${p.id} not found`);
    }
    await cache.invalidate(cache.makeKey(p.tenantId, "in_app_messages", p.userId));
  });
}
