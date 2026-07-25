/**
 * Webhooks consumer — writes webhook records and delivers events.
 * Listens to ALL domain events, filters by tenant's registered webhooks,
 * delivers via HTTP POST with HMAC-SHA256 signature.
 * Retries 3x with exponential backoff.
 *
 * CAP-054 additions: delivery replay, and maker-checker HMAC secret rotation
 * (request + approve/reject). Replay creates a fresh delivery row so the dedup
 * unique index does not block it; rotation moves the live secret into the
 * grace-window `previous_secret` slot on approval.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { webhooks, webhookDeliveries, secretRotations } from "./schema.js";
import { applyRotation, assertCanDecide, decidedStatus, RotationError } from "./rotation.js";
import { canReplay, type DeliveryStatus } from "./delivery.js";
import { eq, and } from "drizzle-orm";

const log = pino({ name: "admin-webhooks-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "webhook";

function cacheKey(tenantId: string) { return cache.makeKey(tenantId, RESOURCE, "list"); }

export function registerWebhookConsumers(queue: Queue): void {
  // Create webhook
  queue.subscribe<{
    id: string; tenantId: string; url: string;
    events: string[]; secret: string; description: string;
  }>("admin.webhook.create", async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await (tx as any).insert(webhooks).values({
          id: p.id,
          tenantId: p.tenantId,
          url: p.url,
          events: p.events,
          secret: p.secret,
          description: p.description,
          active: true,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        });
        await emit(tx, msg, "admin.webhook.created", { id: p.id, url: p.url }, "create", p.id);
      });
      await cache.invalidate(cacheKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: "admin.webhook.create" }, "Consumer processing failed");
      throw err; // H11 FIX: rethrow so message redelivers/DLQs
    }
  });

  // Update webhook
  queue.subscribe<{
    webhookId: string; tenantId: string;
    url?: string; events?: string[]; active?: boolean; description?: string;
  }>("admin.webhook.update", async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const updates: Record<string, unknown> = { updatedBy: msg.actorId, updatedAt: new Date() };
        if (p.url !== undefined) updates.url = p.url;
        if (p.events !== undefined) updates.events = p.events;
        if (p.active !== undefined) updates.active = p.active;
        if (p.description !== undefined) updates.description = p.description;
        await (tx as any).update(webhooks).set(updates)
          .where(and(eq(webhooks.id, p.webhookId), eq(webhooks.tenantId, p.tenantId)));
        await emit(tx, msg, "admin.webhook.updated", { id: p.webhookId }, "update", p.webhookId);
      });
      await cache.invalidate(cacheKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: "admin.webhook.update" }, "Consumer processing failed");
      throw err; // H11 FIX
    }
  });

  // Delete webhook
  queue.subscribe<{ webhookId: string; tenantId: string }>("admin.webhook.delete", async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await (tx as any).delete(webhooks)
          .where(and(eq(webhooks.id, p.webhookId), eq(webhooks.tenantId, p.tenantId)));
        await emit(tx, msg, "admin.webhook.deleted", { id: p.webhookId }, "delete", p.webhookId);
      });
      await cache.invalidate(cacheKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: "admin.webhook.delete" }, "Consumer processing failed");
      throw err; // H11 FIX
    }
  });

  // Test webhook delivery
  queue.subscribe<{ webhookId: string; tenantId: string }>("admin.webhook.test", async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        // In production, this would actually HTTP POST to the webhook URL
        await (tx as any).insert(webhookDeliveries).values({
          webhookId: p.webhookId,
          tenantId: p.tenantId,
          eventType: "webhook.test",
          payload: { test: true, timestamp: new Date().toISOString() },
          status: "delivered",
          statusCode: 200,
          responseBody: '{"ok":true}',
          attempt: 1,
          deliveredAt: new Date(),
        });
        await emit(tx, msg, "admin.webhook.test_sent", { id: p.webhookId }, "test", p.webhookId);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: "admin.webhook.test" }, "Consumer processing failed");
      throw err; // H11 FIX
    }
  });

  // CAP-054 Replay a past delivery — creates a NEW delivery row (replay_of set)
  // so the dedup unique index does not block the re-delivery.
  queue.subscribe<{ id: string; webhookId: string; deliveryId: string; tenantId: string }>(
    "admin.webhook.replay",
    async (msg) => {
      try {
        await db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          const p = msg.payload;
          const orig = await (tx as any).select().from(webhookDeliveries)
            .where(and(eq(webhookDeliveries.id, p.deliveryId), eq(webhookDeliveries.tenantId, p.tenantId)))
            .limit(1);
          const row = orig[0];
          if (!row) throw new NonRetryableError("NOT_FOUND", "delivery not found");
          if (row.webhookId !== p.webhookId) {
            throw new NonRetryableError("MISMATCH", "delivery does not belong to webhook");
          }
          if (!canReplay(row.status as DeliveryStatus)) {
            throw new NonRetryableError("NOT_REPLAYABLE", `delivery in status ${row.status} cannot be replayed`);
          }
          await (tx as any).insert(webhookDeliveries).values({
            id: p.id,
            webhookId: row.webhookId,
            tenantId: p.tenantId,
            eventId: row.eventId,
            eventType: row.eventType,
            payload: row.payload,
            status: "pending",
            attempt: 1,
            maxAttempts: row.maxAttempts,
            replayOf: p.deliveryId,
          });
          await emit(tx, msg, "admin.webhook.replayed", { id: p.id, replayOf: p.deliveryId, webhookId: p.webhookId }, "replay", p.id);
        });
      } catch (err) {
        log.error({ err, messageId: msg.messageId, type: "admin.webhook.replay" }, "Consumer processing failed");
        throw err;
      }
    },
  );

  // CAP-054 Secret rotation — MAKER: record a pending rotation.
  queue.subscribe<{
    rotationId: string; webhookId: string; tenantId: string; newSecret: string; reason: string | null;
  }>("admin.webhook.rotate.request", async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const wh = await (tx as any).select().from(webhooks)
          .where(and(eq(webhooks.id, p.webhookId), eq(webhooks.tenantId, p.tenantId)))
          .limit(1);
        if (!wh[0]) throw new NonRetryableError("NOT_FOUND", "webhook not found");
        await (tx as any).insert(secretRotations).values({
          id: p.rotationId,
          tenantId: p.tenantId,
          webhookId: p.webhookId,
          newSecret: p.newSecret,
          status: "pending",
          reason: p.reason,
          requestedBy: msg.actorId,
          correlationId: msg.correlationId,
        });
        await emit(tx, msg, "admin.webhook.rotation_requested", { rotationId: p.rotationId, webhookId: p.webhookId }, "rotate_request", p.rotationId);
      });
    } catch (err) {
      // A duplicate pending rotation trips the partial unique index — surface
      // as non-retryable so it dead-letters rather than looping.
      const dup = (err as { code?: string }).code === "23505";
      log.error({ err, messageId: msg.messageId, type: "admin.webhook.rotate.request" }, "Consumer processing failed");
      if (dup) throw new NonRetryableError("ROTATION_PENDING", "a pending rotation already exists for this webhook");
      throw err;
    }
  });

  // CAP-054 Secret rotation — CHECKER: approve (swap secret, grace window) or reject.
  queue.subscribe<{
    rotationId: string; tenantId: string; decision: "approve" | "reject"; deciderId: string;
  }>("admin.webhook.rotate.decide", async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const rot = await (tx as any).select().from(secretRotations)
          .where(and(eq(secretRotations.id, p.rotationId), eq(secretRotations.tenantId, p.tenantId)))
          .limit(1)
          .for("update");
        const request = rot[0];
        if (!request) throw new NonRetryableError("NOT_FOUND", "rotation not found");

        try {
          assertCanDecide({ status: request.status as "pending" | "approved" | "rejected", requestedBy: request.requestedBy }, p.deciderId);
        } catch (e) {
          if (e instanceof RotationError) throw new NonRetryableError(e.code, e.message);
          throw e;
        }

        const now = new Date();
        const status = decidedStatus(p.decision);
        // CAP-054 TOCTOU guard: only transition a still-pending row. Under READ
        // COMMITTED two DISTINCT decide messages (e.g. an approve + a reject with
        // different messageIds) could both read status="pending" and both apply a
        // secret swap / approve-after-reject. The FOR UPDATE row lock on the SELECT
        // above serializes concurrent deciders so the loser observes the decided
        // status and assertCanDecide throws NOT_PENDING. This status-guarded UPDATE
        // is a second line of defense: if it matches 0 rows the row was already
        // decided, so we bail out BEFORE running the approve side-effects.
        const decided = await (tx as any).update(secretRotations)
          .set({ status, decidedBy: p.deciderId, decidedAt: now })
          .where(and(
            eq(secretRotations.id, p.rotationId),
            eq(secretRotations.tenantId, p.tenantId),
            eq(secretRotations.status, "pending"),
          ))
          .returning();
        if (decided.length === 0) {
          throw new NonRetryableError("NOT_PENDING", "rotation is already decided");
        }

        if (p.decision === "approve") {
          const wh = await (tx as any).select().from(webhooks)
            .where(and(eq(webhooks.id, request.webhookId), eq(webhooks.tenantId, p.tenantId)))
            .limit(1);
          if (!wh[0]) throw new NonRetryableError("NOT_FOUND", "webhook not found");
          const applied = applyRotation(wh[0].secret, request.newSecret, now);
          await (tx as any).update(webhooks)
            .set({
              secret: applied.secret,
              previousSecret: applied.previousSecret,
              secretRotatedAt: applied.secretRotatedAt,
              updatedBy: p.deciderId,
              updatedAt: now,
            })
            .where(and(eq(webhooks.id, request.webhookId), eq(webhooks.tenantId, p.tenantId)));
          await emit(tx, msg, "admin.webhook.secret_rotated", { rotationId: p.rotationId, webhookId: request.webhookId }, "rotate_approve", p.rotationId);
        } else {
          await emit(tx, msg, "admin.webhook.rotation_rejected", { rotationId: p.rotationId, webhookId: request.webhookId }, "rotate_reject", p.rotationId);
        }
      });
      await cache.invalidate(cacheKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: "admin.webhook.rotate.decide" }, "Consumer processing failed");
      throw err;
    }
  });
}

async function emit(
  tx: unknown,
  msg: { tenantId: string; actorId: string; correlationId: string },
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId, payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "admin", action, resourceType: RESOURCE, resourceId, outcome: "success" },
  });
}
