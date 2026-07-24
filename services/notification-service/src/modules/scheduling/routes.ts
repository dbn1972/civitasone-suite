import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { validateScheduledAt } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin", "notification_admin"];

const scheduleBody = z.object({
  templateId: z.string().uuid(),
  recipient: z.string().min(1).max(254),
  recipientId: z.string().uuid().optional(),
  channel: z.string().min(1).max(32),
  priority: z.enum(["low", "normal", "high", "critical"]).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  scheduledAt: z.string().datetime(),
});

const scheduleIdParam = z.object({ id: z.string().uuid() });
const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function schedulingRoutes(app: FastifyInstance): Promise<void> {
  // Schedule a notification
  app.post("/v1/scheduling", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = scheduleBody.parse(req.body);

    if (!validateScheduledAt(body.scheduledAt)) {
      throw new HttpError(400, "INVALID_SCHEDULE", "scheduledAt must be a valid future timestamp");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.scheduleNotification(ctx, body));
  });

  // Cancel a scheduled notification
  app.delete("/v1/scheduling/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = scheduleIdParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.cancelSchedule(ctx, id));
  });

  // List scheduled notifications
  app.get("/v1/scheduling", async (req, reply) => {
    const ctx = resolveContext(req);
    const pagination = paginationQuery.parse(req.query);
    const schedules = await repo.listScheduled(ctx.tenantId, pagination);
    return reply.send({ data: schedules, meta: { page: Math.floor(pagination.offset / pagination.limit) + 1, pageSize: pagination.limit, total: schedules.length } });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
