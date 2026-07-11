/**
 * visitor-service: DPDP compliance routes.
 *
 * Requirement 18.4 — Right to Erasure:
 *   POST /v1/visitor/dpdp/erasure-requests
 *   Accepts a visitor reference (visitorRef) or phone number (visitorPhone),
 *   marks all matching visit_requests with `erasure_requested_at = now()`,
 *   sends a NOTIFICATION_SEND confirmation to the visitor, and returns 202
 *   Accepted. Actual PII deletion happens within 72h via a scheduled purge
 *   worker (task 20.2).
 *
 * Access: dpo (data protection officer), tenant_admin, super_admin.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, or, isNull, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { visitRequests } from "../visit-request/schema.js";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";

const ERASURE_ROLES = ["dpo", "tenant_admin", "super_admin"];

/**
 * Zod schema for erasure request body.
 * At least one of visitorRef or visitorPhone must be provided.
 */
const erasureRequestBody = z.object({
  visitorRef: z.string().min(1).optional(),
  visitorPhone: z.string().min(1).optional(),
}).refine(
  (data) => Boolean(data.visitorRef) || Boolean(data.visitorPhone),
  { message: "At least one of visitorRef or visitorPhone must be provided" },
);

export async function dpdpRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/visitor/dpdp/erasure-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ERASURE_ROLES);

    const body = erasureRequestBody.parse(req.body);
    const now = new Date();
    const erasureId = randomUUID();

    // Build the WHERE condition to find matching visit requests for this tenant.
    // Match by tracking_ref (visitorRef) or visitor_phone (visitorPhone).
    // Only mark rows that have NOT already been marked for erasure.
    const conditions: SQL[] = [];
    if (body.visitorRef) {
      conditions.push(eq(visitRequests.trackingRef, body.visitorRef));
    }
    if (body.visitorPhone) {
      conditions.push(eq(visitRequests.visitorPhone, body.visitorPhone));
    }

    // Perform the update within a transaction: mark matching rows + enqueue notification
    const result = await db.transaction(async (tx) => {
      const matchCondition = conditions.length === 1 ? conditions[0]! : or(...conditions)!;

      const updated = await tx
        .update(visitRequests)
        .set({
          erasureRequestedAt: now,
          updatedAt: now,
          updatedBy: ctx.actorId,
        })
        .where(
          and(
            eq(visitRequests.tenantId, ctx.tenantId),
            matchCondition,
            isNull(visitRequests.erasureRequestedAt),
          ),
        )
        .returning({ id: visitRequests.id, visitorPhone: visitRequests.visitorPhone });

      // Send NOTIFICATION_SEND confirmation to the visitor (Requirement 18.4)
      // Use the first matched record's phone as the recipient, or the provided phone.
      const recipientPhone = updated[0]?.visitorPhone ?? body.visitorPhone;
      if (recipientPhone) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          correlationId: ctx.correlationId,
          payload: buildNotificationPayload({
            eventType: "visitor.dpdp.erasure_confirmed",
            recipient: recipientPhone,
            channel: "sms",
            variables: {
              erasureId,
              requestedAt: now.toISOString(),
              message: "Your personal data erasure request has been accepted and will be processed within 72 hours.",
            },
          }),
        });
      }

      return { count: updated.length };
    });

    return reply.code(202).send({
      data: {
        erasureId,
        status: "accepted",
        recordsMarked: result.count,
        message: "Erasure request accepted. PII will be removed within 72 hours.",
      },
    });
  });
}
