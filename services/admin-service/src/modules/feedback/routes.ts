/**
 * Page-level feedback widget intake (the web FeedbackWidget fires this on
 * every thumbs-up/down). Feedback is recorded on the audit trail
 * (audit.event.record via the transactional outbox) — durable and queryable
 * in audit-service without a dedicated table for a lightweight signal.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { auditEvent } from "../../shared/audit.js";

const feedbackBody = z.object({
  page: z.string().min(1).max(512),
  rating: z.enum(["positive", "negative"]),
  comment: z.string().max(2000).optional(),
  timestamp: z.string().datetime().optional(),
});

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  // Any authenticated user may leave feedback — no role guard beyond auth.
  app.post("/v1/admin/feedback", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = feedbackBody.parse(req.body);
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await auditEvent(tx, ctx, "feedback_submitted", "page_feedback", id, {
        page: body.page,
        rating: body.rating,
        ...(body.comment ? { comment: body.comment } : {}),
        ...(body.timestamp ? { submittedAt: body.timestamp } : {}),
      });
    });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });
}
