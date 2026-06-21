import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import {
  NotificationItemListSchema,
  NotificationPrefSummaryListSchema,
} from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, HttpError } from "../../shared/context.js";
import * as deliveryQueries from "../deliveries/queries.js";
import * as templateQueries from "../templates/queries.js";

export async function inboxRoutes(app: FastifyInstance): Promise<void> {
  app.get("/notifications/notifications", async (req, reply) => {
    const ctx = resolveContext(req);
    const q = listQuerySchema.parse(req.query);
    const rows = await deliveryQueries.listDeliveries(ctx.tenantId, q.limit, q.offset, ctx.actorId);
    sendValidated(reply, NotificationItemListSchema, rows.map((d) => ({
      id: d.id,
      title: d.templateId,
      message: d.errorDetail ?? d.error ?? "",
      module: "notification",
      eventType: d.channel,
      recipient: d.recipient,
      channel: (d.channel === "email" ? "email" : d.channel === "sms" ? "sms" : d.channel === "webhook" ? "webhook" : "in_app") as "email" | "sms" | "in_app" | "webhook",
      status: (d.status === "delivered" || d.status === "sent" ? "sent" : d.status === "failed" ? "failed" : "pending") as "sent" | "pending" | "failed" | "read",
      createdAt: d.createdAt.toISOString(),
    })));
  });

  app.get("/notifications/preferences", async (req, reply) => {
    const ctx = resolveContext(req);
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

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
