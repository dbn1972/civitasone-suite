import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import {
  NotificationItemListSchema,
  NotificationPrefSummaryListSchema,
} from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as deliveryQueries from "../deliveries/queries.js";
import * as templateQueries from "../templates/queries.js";

const PREF_ADMIN_ROLES = ["notification_admin", "super_admin", "tenant_admin", "platform_admin"];

export async function inboxRoutes(app: FastifyInstance): Promise<void> {
  app.get("/notifications/notifications", async (req, reply) => {
    const ctx = resolveContext(req);
    const q = listQuerySchema.parse(req.query);
    // P1-3: inbox is recipient-scoped — only notifications addressed TO the actor.
    const rows = await deliveryQueries.listInbox(ctx.tenantId, ctx.actorId, q.limit, q.offset);
    sendValidated(reply, NotificationItemListSchema, rows.map((d) => ({
      id: d.id,
      title: d.templateId,
      message: d.errorDetail ?? d.error ?? "",
      module: "notification",
      eventType: d.channel,
      recipient: d.recipient,
      channel: (d.channel === "email" ? "email" : d.channel === "sms" ? "sms" : d.channel === "webhook" ? "webhook" : "in_app") as "email" | "sms" | "in_app" | "webhook",
      status: (d.status === "delivered" || d.status === "sent" ? "sent" : d.status === "failed" ? "failed" : "pending") as "sent" | "pending" | "failed" | "read",
      createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
    })));
  });

  app.get("/notifications/preferences", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PREF_ADMIN_ROLES);
    const q = listQuerySchema.parse(req.query);
    const prefs = await templateQueries.listTenantPrefs(ctx.tenantId, q.limit);
    sendValidated(reply, NotificationPrefSummaryListSchema, prefs.map((p) => ({
      id: p.id,
      eventType: p.eventType,
      module: "notification",
      label: p.eventType.replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      emailEnabled: p.email,
      smsEnabled: false,
      inAppEnabled: p.inApp,
      webhookEnabled: false,
    })));
  });


  // GET /notifications/notifications/:id — single inbox item (recipient-scoped)
  app.get("/notifications/notifications/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await deliveryQueries.getDelivery(ctx.tenantId, id);
    if (!row || row.recipientId !== ctx.actorId) throw new HttpError(404, "NOT_FOUND", "notification not found");
    return reply.code(200).send({
      data: {
        id: row.id,
        title: row.templateId,
        message: row.errorDetail ?? row.error ?? "",
        module: "notification",
        eventType: row.channel,
        recipient: row.recipient,
        channel: (row.channel === "email" ? "email" : row.channel === "sms" ? "sms" : row.channel === "webhook" ? "webhook" : "in_app"),
        status: (row.status === "read" ? "read" : row.status === "failed" ? "failed" : row.status === "delivered" || row.status === "sent" ? "sent" : "pending"),
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      },
    });
  });

  // PATCH /notifications/notifications/:id/read — mark single notification as read
  app.patch("/notifications/notifications/:id/read", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const updated = await deliveryQueries.markAsRead(ctx.tenantId, ctx.actorId, id);
    if (!updated) throw new HttpError(404, "NOT_FOUND", "notification not found or already read");
    return reply.code(204).send();
  });

  // POST /notifications/notifications/read-all — mark all inbox items as read
  app.post("/notifications/notifications/read-all", async (req, reply) => {
    const ctx = resolveContext(req);
    const count = await deliveryQueries.markAllAsRead(ctx.tenantId, ctx.actorId);
    return reply.code(200).send({ ok: true, count });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
