import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createTemplateBody, setPrefsBody, updatePrefsBody, updateTemplateBody, templateIdParam, prefIdParam, userIdParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  app.post("/notifications/templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = createTemplateBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createTemplate(ctx, body));
  });

  app.get("/notifications/templates", async (req, reply) => {
    const ctx = resolveContext(req);
    return reply.send(await queries.listTemplates(ctx.tenantId));
  });

  app.patch("/notifications/templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = templateIdParam.parse(req.params);
    const body = updateTemplateBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateTemplate(ctx, id, body));
  });

  app.get("/notifications/templates/:id/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = templateIdParam.parse(req.params);
    return reply.send(await queries.listTemplateVersions(ctx.tenantId, id));
  });

  app.post("/notifications/preferences/:userId", async (req, reply) => {
    const ctx = resolveContext(req);
    const { userId } = userIdParam.parse(req.params);
    // IDOR guard: users can only set their own preferences; admins can set any
    if (userId !== ctx.actorId && !ctx.roles.includes("notification_admin") && !ctx.roles.includes("super_admin")) {
      throw new HttpError(403, "FORBIDDEN", "Cannot modify another user's notification preferences");
    }
    const body = setPrefsBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.setPrefs(ctx, userId, body));
  });

  app.get("/notifications/preferences/:userId", async (req, reply) => {
    const ctx = resolveContext(req);
    const { userId } = userIdParam.parse(req.params);
    // IDOR guard: users can only read their own preferences; admins can read any
    if (userId !== ctx.actorId && !ctx.roles.includes("notification_admin") && !ctx.roles.includes("super_admin")) {
      throw new HttpError(403, "FORBIDDEN", "Cannot read another user's notification preferences");
    }
    return reply.send(await queries.getUserPrefs(ctx.tenantId, userId));
  });

  // Tenant-admin "Save changes" on the notification preferences screen. Updates
  // one existing pref row's channels by id, scoped to the caller's tenant. A
  // wrong-tenant / unknown id is a 404 (never a cross-tenant write). Admin-gated.
  app.patch("/notifications/prefs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = prefIdParam.parse(req.params);
    const body = updatePrefsBody.parse(req.body);
    const existing = await queries.getPrefById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "preference not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.updatePrefs(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
