/**
 * CH-07 — Routes for managing unmatched inbound contact review queue.
 *
 * GET  /notifications/inbox/review-queue          — list pending items (paginated)
 * POST /notifications/inbox/review-queue/:id/link — link to an existing contact
 * POST /notifications/inbox/review-queue/:id/discard — mark as discarded
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

const REVIEW_QUEUE_ROLES = ["notification_admin", "helpdesk_admin", "super_admin"];

const linkBody = z.object({
  contactId: z.string().uuid(),
});

const discardBody = z.object({
  reason: z.string().min(1).max(500).optional(),
});

/** CH-07: Unified resolve body as per the spec requirement */
const resolveBody = z.object({
  action: z.enum(["link", "discard", "create_lead"]),
  contactId: z.string().uuid().optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["pending", "linked", "discarded"]).default("pending"),
});

export async function reviewQueueRoutes(app: FastifyInstance): Promise<void> {
  // List review queue items
  app.get("/notifications/inbox/review-queue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVIEW_QUEUE_ROLES);
    const q = listQuery.parse(req.query);

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT id, tenant_id AS "tenantId", channel, sender_identifier AS "senderIdentifier",
             message_content AS "messageContent", metadata, status,
             linked_contact_id AS "linkedContactId",
             created_at AS "createdAt", resolved_at AS "resolvedAt", resolved_by AS "resolvedBy"
      FROM notification.inbound_review_queue
      WHERE tenant_id = ${ctx.tenantId} AND status = ${q.status}
      ORDER BY created_at DESC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `));

    const countResult = await scopedRead((tx) => tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM notification.inbound_review_queue
      WHERE tenant_id = ${ctx.tenantId} AND status = ${q.status}
    `)) as unknown as Array<{ total: number }>;

    return reply.code(200).send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: countResult[0]?.total ?? 0 },
    });
  });

  // Link to an existing contact (alias: /resolve for spec compatibility)
  app.post("/notifications/inbox/review-queue/:id/link", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVIEW_QUEUE_ROLES);
    const { id } = req.params as { id: string };
    const body = linkBody.parse(req.body);

    const result = await scopedRead((tx) => tx.execute(sql`
      UPDATE notification.inbound_review_queue
      SET status = 'linked',
          linked_contact_id = ${body.contactId},
          resolved_at = now(),
          resolved_by = ${ctx.actorId}
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND status = 'pending'
      RETURNING id
    `)) as unknown as Array<{ id: string }>;

    if (result.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "review queue item not found or already resolved");
    }

    return reply.code(200).send({ data: { id, status: "linked", linkedContactId: body.contactId } });
  });

  // CH-07: Unified resolve endpoint (spec-compliant)
  app.post("/notifications/inbox/review-queue/:id/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVIEW_QUEUE_ROLES);
    const { id } = req.params as { id: string };
    const body = resolveBody.parse(req.body);

    if (body.action === "link") {
      if (!body.contactId) {
        throw new HttpError(400, "VALIDATION_ERROR", "contactId is required for link action");
      }
      const result = await scopedRead((tx) => tx.execute(sql`
        UPDATE notification.inbound_review_queue
        SET status = 'linked',
            linked_contact_id = ${body.contactId},
            resolved_at = now(),
            resolved_by = ${ctx.actorId}
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND status = 'pending'
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      if (result.length === 0) {
        throw new HttpError(404, "NOT_FOUND", "review queue item not found or already resolved");
      }
      return reply.code(200).send({ data: { id, status: "linked", contactId: body.contactId } });
    }

    if (body.action === "discard") {
      const result = await scopedRead((tx) => tx.execute(sql`
        UPDATE notification.inbound_review_queue
        SET status = 'discarded',
            resolved_at = now(),
            resolved_by = ${ctx.actorId}
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND status = 'pending'
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      if (result.length === 0) {
        throw new HttpError(404, "NOT_FOUND", "review queue item not found or already resolved");
      }
      return reply.code(200).send({ data: { id, status: "discarded" } });
    }

    // create_lead: mark as resolved, downstream creates the lead
    const result = await scopedRead((tx) => tx.execute(sql`
      UPDATE notification.inbound_review_queue
      SET status = 'linked',
          resolved_at = now(),
          resolved_by = ${ctx.actorId}
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND status = 'pending'
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    if (result.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "review queue item not found or already resolved");
    }
    return reply.code(200).send({ data: { id, status: "create_lead" } });
  });

  // Resolve (spec-compliant alias for link)
  app.post("/notifications/contact-review-queue/:id/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVIEW_QUEUE_ROLES);
    const { id } = req.params as { id: string };
    const body = linkBody.parse(req.body);

    const result = await scopedRead((tx) => tx.execute(sql`
      UPDATE notification.inbound_review_queue
      SET status = 'linked',
          linked_contact_id = ${body.contactId},
          resolved_at = now(),
          resolved_by = ${ctx.actorId}
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND status = 'pending'
      RETURNING id
    `)) as unknown as Array<{ id: string }>;

    if (result.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "review queue item not found or already resolved");
    }

    return reply.code(200).send({ data: { id, status: "resolved", contactId: body.contactId } });
  });

  // Discard
  app.post("/notifications/inbox/review-queue/:id/discard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVIEW_QUEUE_ROLES);
    const { id } = req.params as { id: string };
    const body = discardBody.parse(req.body);

    const metadata = body.reason ? { discardReason: body.reason } : {};

    const result = await scopedRead((tx) => tx.execute(sql`
      UPDATE notification.inbound_review_queue
      SET status = 'discarded',
          metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb,
          resolved_at = now(),
          resolved_by = ${ctx.actorId}
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND status = 'pending'
      RETURNING id
    `)) as unknown as Array<{ id: string }>;

    if (result.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "review queue item not found or already resolved");
    }

    return reply.code(200).send({ data: { id, status: "discarded" } });
  });

  // Spec-compliant alias routes
  app.get("/notifications/contact-review-queue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVIEW_QUEUE_ROLES);
    const q = listQuery.parse(req.query);

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT id, tenant_id AS "tenantId", channel, sender_identifier AS "senderIdentifier",
             message_content AS "messageContent", metadata, status,
             linked_contact_id AS "linkedContactId",
             created_at AS "createdAt", resolved_at AS "resolvedAt", resolved_by AS "resolvedBy"
      FROM notification.inbound_review_queue
      WHERE tenant_id = ${ctx.tenantId} AND status = ${q.status}
      ORDER BY created_at DESC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `));

    const countResult = await scopedRead((tx) => tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM notification.inbound_review_queue
      WHERE tenant_id = ${ctx.tenantId} AND status = ${q.status}
    `)) as unknown as Array<{ total: number }>;

    return reply.code(200).send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: countResult[0]?.total ?? 0 },
    });
  });

  app.post("/notifications/contact-review-queue/:id/discard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVIEW_QUEUE_ROLES);
    const { id } = req.params as { id: string };
    const body = discardBody.parse(req.body);

    const metadata = body.reason ? { discardReason: body.reason } : {};

    const result = await scopedRead((tx) => tx.execute(sql`
      UPDATE notification.inbound_review_queue
      SET status = 'discarded',
          metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb,
          resolved_at = now(),
          resolved_by = ${ctx.actorId}
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND status = 'pending'
      RETURNING id
    `)) as unknown as Array<{ id: string }>;

    if (result.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "review queue item not found or already resolved");
    }

    return reply.code(200).send({ data: { id, status: "discarded" } });
  });
}
