/**
 * visitor-service: DPDP erasure consumer.
 *
 * Handles `COMMANDS.dpdpErasureRequest` (Requirement 18.4, Right to
 * Erasure):
 *   markProcessed(tx, msg.messageId) -> mark all matching `visit_requests`
 *   rows with `erasure_requested_at = now()` -> outbox NOTIFICATION_SEND
 *   confirmation to the visitor.
 *
 * Task Q-95.2: moved off the synchronous route-handler UPDATE onto the
 * queue-first CQRS convention (see ./commands.ts for the SLA rationale).
 * The `isNull(erasureRequestedAt)` guard makes a redelivery of the same
 * command a no-op on the second pass, same as the original route logic.
 */
import { eq, and, or, isNull, type SQL } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { visitRequests } from "../visit-request/schema.js";

const AUDIT_TOPIC = "audit.event.record";

export interface DpdpErasureRequestPayload {
  erasureId: string;
  tenantId: string;
  visitorRef: string | null;
  visitorPhone: string | null;
}

export function registerDpdpConsumers(queue: Queue): void {
  queue.subscribe<DpdpErasureRequestPayload>(COMMANDS.dpdpErasureRequest, async (msg) => {
    const p = msg.payload;
    const now = new Date();

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      const conditions: SQL[] = [];
      if (p.visitorRef) conditions.push(eq(visitRequests.trackingRef, p.visitorRef));
      if (p.visitorPhone) conditions.push(eq(visitRequests.visitorPhone, p.visitorPhone));
      if (conditions.length === 0) return; // validator on the route guarantees at least one, defensive no-op

      const matchCondition = conditions.length === 1 ? conditions[0]! : or(...conditions)!;

      const updated = await tx
        .update(visitRequests)
        .set({
          erasureRequestedAt: now,
          updatedAt: now,
          updatedBy: msg.actorId,
        })
        .where(
          and(
            eq(visitRequests.tenantId, p.tenantId),
            matchCondition,
            isNull(visitRequests.erasureRequestedAt),
          ),
        )
        .returning({ id: visitRequests.id, visitorPhone: visitRequests.visitorPhone });

      await enqueue(tx, {
        topic: EVENTS.dpdpErasureAccepted,
        eventType: EVENTS.dpdpErasureAccepted,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { erasureId: p.erasureId, recordsMarked: updated.length },
      });

      // Requirement 18.4: notify the visitor via SMS that erasure was accepted.
      const recipientPhone = updated[0]?.visitorPhone ?? p.visitorPhone;
      if (recipientPhone) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: "visitor.dpdp.erasure_confirmed",
            recipient: recipientPhone,
            channel: "sms",
            variables: {
              erasureId: p.erasureId,
              requestedAt: now.toISOString(),
              message: "Your personal data erasure request has been accepted and will be processed within 72 hours.",
            },
          }),
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "dpdp", resourceId: msg.messageId, outcome: "success" } });
      }
    });
  });
}
