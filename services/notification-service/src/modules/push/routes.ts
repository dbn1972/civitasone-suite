/**
 * MT-006 — web push channel + in-app messaging inbox.
 *
 * POST   /v1/notification/push/subscriptions        — register a device (202)
 * GET    /v1/notification/push/subscriptions        — list (tokens masked)
 * DELETE /v1/notification/push/subscriptions/:id    — revoke (202)
 * POST   /v1/notification/push/send                 — send via the shared send path (202)
 * POST   /v1/notification/in-app/messages           — create an in-app message (202)
 * GET    /v1/notification/in-app/messages           — per-user inbox with read state
 * POST   /v1/notification/in-app/messages/:id/read  — mark read (202)
 *
 * Device tokens are secrets: they are accepted in the request body, stored
 * encrypted, and never returned (only a masked preview) or logged.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { isValidWebPushEndpoint } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ADMIN_ROLES = ["notification_admin", "super_admin", "tenant_admin", "platform_admin"];
/** Any authenticated user may manage their OWN device registrations and inbox. */
const SELF_ROLES = [...ADMIN_ROLES, "employee", "citizen", "helpdesk_user"];

const registerBody = z.object({
  userId: z.string().uuid().optional(),
  platform: z.enum(["web", "android", "ios"]),
  deviceToken: z.string().min(8).max(4096),
  endpoint: z.string().url().max(2048).optional(),
  userAgent: z.string().max(400).optional(),
});

const sendBody = z.object({
  userId: z.string().uuid(),
  templateId: z.string().uuid().optional(),
  subject: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(4000),
  eventType: z.string().min(1).max(120).optional(),
});

const inAppBody = z.object({
  userId: z.string().uuid(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  severity: z.enum(["info", "warning", "action_required"]).optional(),
  actionUrl: z.string().url().max(2048).optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200),
  offset: z.coerce.number().int().min(0).default(0),
  userId: z.string().uuid().optional(),
});

const inboxQuery = listQuery.extend({
  unreadOnly: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

const idParam = z.object({ id: z.string().uuid() });

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/notification/push/subscriptions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELF_ROLES);
    const body = registerBody.parse(req.body);
    // Registering on behalf of ANOTHER user is an admin action; a normal user
    // may only register their own device.
    const userId = body.userId ?? ctx.actorId;
    if (userId !== ctx.actorId) requireRole(ctx, ADMIN_ROLES);
    // 422: a web subscription without an https endpoint cannot be delivered to.
    if (body.platform === "web" && (body.endpoint === undefined || !isValidWebPushEndpoint(body.endpoint))) {
      throw new HttpError(422, "INVALID_ENDPOINT", "web push requires an https endpoint");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.registerSubscription(ctx, {
      userId,
      platform: body.platform,
      deviceToken: body.deviceToken,
      ...(body.endpoint !== undefined ? { endpoint: body.endpoint } : {}),
      ...(body.userAgent !== undefined ? { userAgent: body.userAgent } : {}),
    }));
  });

  app.get("/v1/notification/push/subscriptions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELF_ROLES);
    const q = listQuery.parse(req.query);
    const userId = q.userId ?? ctx.actorId;
    if (userId !== ctx.actorId) requireRole(ctx, ADMIN_ROLES);
    const { rows, total } = await repo.listSubscriptions(ctx.tenantId, userId, q.limit, q.offset);
    return reply.send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  app.delete("/v1/notification/push/subscriptions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELF_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.revokeSubscription(ctx, id));
  });

  app.post("/v1/notification/push/send", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = sendBody.parse(req.body);
    // 422: pushing to a user with no active device is a no-op the caller should
    // know about, rather than a delivery that silently never arrives.
    const subs = await repo.findActiveSubscriptions(ctx.tenantId, body.userId);
    if (subs.length === 0) {
      throw new HttpError(422, "NO_ACTIVE_SUBSCRIPTION", "user has no active push subscription");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.sendPush(ctx, {
      userId: body.userId,
      body: body.body,
      ...(body.templateId !== undefined ? { templateId: body.templateId } : {}),
      ...(body.subject !== undefined ? { subject: body.subject } : {}),
      ...(body.eventType !== undefined ? { eventType: body.eventType } : {}),
    }));
  });

  app.post("/v1/notification/in-app/messages", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = inAppBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createInAppMessage(ctx, {
      userId: body.userId,
      title: body.title,
      body: body.body,
      ...(body.severity !== undefined ? { severity: body.severity } : {}),
      ...(body.actionUrl !== undefined ? { actionUrl: body.actionUrl } : {}),
    }));
  });

  app.get("/v1/notification/in-app/messages", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELF_ROLES);
    const q = inboxQuery.parse(req.query);
    const userId = q.userId ?? ctx.actorId;
    if (userId !== ctx.actorId) requireRole(ctx, ADMIN_ROLES);
    const { rows, total, unread } = await repo.listInAppMessages(
      ctx.tenantId, userId, q.limit, q.offset, q.unreadOnly,
    );
    return reply.send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total, unread },
    });
  });

  app.post("/v1/notification/in-app/messages/:id/read", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELF_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findInAppMessage(ctx.tenantId, ctx.actorId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "in-app message not found");
    return sendAccepted(
      reply, acceptedResponseSchema,
      await commands.markInAppRead(ctx, id, ctx.actorId),
    );
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
