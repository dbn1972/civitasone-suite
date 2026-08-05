/**
 * G5 — Conversation Thread Model routes.
 *
 * POST   /notifications/conversations            — start new conversation
 * GET    /notifications/conversations            — list (filter by contact_id, channel, status)
 * GET    /notifications/conversations/:id        — get conversation detail
 * GET    /notifications/conversations/:id/messages — list messages (paginated, newest first)
 * POST   /notifications/conversations/:id/messages — add message to thread
 * PATCH  /notifications/conversations/:id        — update status / assign agent
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, readScoped } from "../../shared/db.js";
import { conversations, conversationMessages } from "./schema.js";
import { runWithTenant } from "@civitasone/db";

const ALLOWED_ROLES = ["notification_user", "notification_admin", "super_admin", "tenant_admin", "helpdesk_user", "helpdesk_admin"];

const CHANNELS = ["email", "sms", "whatsapp", "webchat", "voice"] as const;
const STATUSES = ["open", "closed", "archived"] as const;
const DIRECTIONS = ["inbound", "outbound"] as const;
const CONTENT_TYPES = ["text", "media", "template", "system"] as const;
const MSG_STATUSES = ["sent", "delivered", "read", "failed"] as const;

// ─── Zod schemas ────────────────────────────────────────────────────────────────

const createConversationBody = z.object({
  contactId: z.string().uuid(),
  channel: z.enum(CHANNELS),
  subject: z.string().max(500).optional(),
  providerThreadId: z.string().max(256).optional(),
  assignedTo: z.string().uuid().optional(),
});

const listConversationsQuery = z.object({
  contactId: z.string().uuid().optional(),
  channel: z.enum(CHANNELS).optional(),
  status: z.enum(STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const conversationIdParam = z.object({ id: z.string().uuid() });

const listMessagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const createMessageBody = z.object({
  direction: z.enum(DIRECTIONS),
  content: z.string().optional(),
  contentType: z.enum(CONTENT_TYPES).default("text"),
  providerMessageId: z.string().max(256).optional(),
  status: z.enum(MSG_STATUSES).default("sent"),
});

const patchConversationBody = z.object({
  status: z.enum(STATUSES).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  subject: z.string().max(500).optional(),
});

// ─── Route registration ─────────────────────────────────────────────────────────

export async function conversationRoutes(app: FastifyInstance): Promise<void> {

  // POST /notifications/conversations — create
  app.post("/notifications/conversations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);
    const body = createConversationBody.parse(req.body);

    const rows = await runWithTenant(ctx.tenantId, () =>
      db.transaction(async (tx) =>
        tx.insert(conversations).values({
          tenantId: ctx.tenantId,
          contactId: body.contactId,
          channel: body.channel,
          subject: body.subject ?? null,
          providerThreadId: body.providerThreadId ?? null,
          assignedTo: body.assignedTo ?? null,
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
        }).returning(),
      ),
    );
    const row = rows[0]!;

    return reply.code(201).send({ data: formatConversation(row) });
  });

  // GET /notifications/conversations — list
  app.get("/notifications/conversations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);
    const q = listConversationsQuery.parse(req.query);

    const rows = await readScoped(ctx.tenantId, async (tx) => {
      const conditions = [eq(conversations.tenantId, ctx.tenantId)];
      if (q.contactId) conditions.push(eq(conversations.contactId, q.contactId));
      if (q.channel) conditions.push(eq(conversations.channel, q.channel));
      if (q.status) conditions.push(eq(conversations.status, q.status));

      return tx.select().from(conversations)
        .where(and(...conditions))
        .orderBy(desc(conversations.lastMessageAt), desc(conversations.startedAt))
        .limit(q.limit)
        .offset(q.offset);
    });

    return reply.send({ data: rows.map(formatConversation), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: rows.length } });
  });

  // GET /notifications/conversations/:id — detail
  app.get("/notifications/conversations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);
    const { id } = conversationIdParam.parse(req.params);

    const [row] = await readScoped(ctx.tenantId, async (tx) =>
      tx.select().from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)))
        .limit(1),
    );

    if (!row) throw new HttpError(404, "NOT_FOUND", "conversation not found");
    return reply.send({ data: formatConversation(row) });
  });

  // GET /notifications/conversations/:id/messages — list messages
  app.get("/notifications/conversations/:id/messages", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);
    const { id } = conversationIdParam.parse(req.params);
    const q = listMessagesQuery.parse(req.query);

    // Verify conversation exists and belongs to tenant
    const [convo] = await readScoped(ctx.tenantId, async (tx) =>
      tx.select({ id: conversations.id }).from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!convo) throw new HttpError(404, "NOT_FOUND", "conversation not found");

    const rows = await readScoped(ctx.tenantId, async (tx) =>
      tx.select().from(conversationMessages)
        .where(and(eq(conversationMessages.conversationId, id), eq(conversationMessages.tenantId, ctx.tenantId)))
        .orderBy(desc(conversationMessages.sentAt))
        .limit(q.limit)
        .offset(q.offset),
    );

    return reply.send({ data: rows.map(formatMessage), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: rows.length } });
  });

  // POST /notifications/conversations/:id/messages — add message
  app.post("/notifications/conversations/:id/messages", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);
    const { id } = conversationIdParam.parse(req.params);
    const body = createMessageBody.parse(req.body);

    // Verify conversation exists and belongs to tenant
    const [convo] = await readScoped(ctx.tenantId, async (tx) =>
      tx.select({ id: conversations.id }).from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!convo) throw new HttpError(404, "NOT_FOUND", "conversation not found");

    const now = new Date();

    const msgs = await runWithTenant(ctx.tenantId, () =>
      db.transaction(async (tx) => {
        const inserted = await tx.insert(conversationMessages).values({
          tenantId: ctx.tenantId,
          conversationId: id,
          direction: body.direction,
          content: body.content ?? null,
          contentType: body.contentType,
          providerMessageId: body.providerMessageId ?? null,
          status: body.status,
          createdBy: ctx.actorId,
        }).returning();

        // Update last_message_at and increment message_count
        await tx.update(conversations)
          .set({
            lastMessageAt: now,
            messageCount: sql`${conversations.messageCount} + 1`,
            updatedAt: now,
            updatedBy: ctx.actorId,
          })
          .where(and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)));

        return inserted;
      }),
    );
    const msg = msgs[0]!;

    return reply.code(201).send({ data: formatMessage(msg) });
  });

  // PATCH /notifications/conversations/:id — update status/assign
  app.patch("/notifications/conversations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);
    const { id } = conversationIdParam.parse(req.params);
    const body = patchConversationBody.parse(req.body);

    // Verify conversation exists and belongs to tenant
    const [existing] = await readScoped(ctx.tenantId, async (tx) =>
      tx.select().from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!existing) throw new HttpError(404, "NOT_FOUND", "conversation not found");

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy: ctx.actorId,
      version: sql`${conversations.version} + 1`,
    };
    if (body.status !== undefined) {
      updates.status = body.status;
      if (body.status === "closed") updates.closedAt = new Date();
    }
    if (body.assignedTo !== undefined) updates.assignedTo = body.assignedTo;
    if (body.subject !== undefined) updates.subject = body.subject;

    const updatedRows = await runWithTenant(ctx.tenantId, () =>
      db.transaction(async (tx) =>
        tx.update(conversations)
          .set(updates)
          .where(and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)))
          .returning(),
      ),
    );
    const updated = updatedRows[0]!;

    return reply.send({ data: formatConversation(updated) });
  });

  // ─── Error handler ──────────────────────────────────────────────────────────
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}

// ─── Formatters ─────────────────────────────────────────────────────────────────

function formatConversation(row: typeof conversations.$inferSelect) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    contactId: row.contactId,
    channel: row.channel,
    status: row.status,
    subject: row.subject,
    providerThreadId: row.providerThreadId,
    startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : String(row.startedAt),
    lastMessageAt: row.lastMessageAt instanceof Date ? row.lastMessageAt.toISOString() : row.lastMessageAt,
    messageCount: row.messageCount,
    closedAt: row.closedAt instanceof Date ? row.closedAt.toISOString() : row.closedAt,
    assignedTo: row.assignedTo,
    version: row.version,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

function formatMessage(row: typeof conversationMessages.$inferSelect) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    direction: row.direction,
    content: row.content,
    contentType: row.contentType,
    providerMessageId: row.providerMessageId,
    status: row.status,
    sentAt: row.sentAt instanceof Date ? row.sentAt.toISOString() : String(row.sentAt),
    deliveredAt: row.deliveredAt instanceof Date ? row.deliveredAt.toISOString() : row.deliveredAt,
    readAt: row.readAt instanceof Date ? row.readAt.toISOString() : row.readAt,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}
