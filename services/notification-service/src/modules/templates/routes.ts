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

  // Single-template read. crm-service (send / bulk-send template-variable validation and
  // template-preview) fetches a template by id over the internal service path; without this
  // route every such lookup was a 404.
  app.get("/notifications/templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = templateIdParam.parse(req.params);
    const template = await queries.getTemplate(ctx.tenantId, id);
    // findTemplateById is not tenant-filtered, so the tenant check here is what isolates tenants.
    if (!template || template.tenantId !== ctx.tenantId) {
      throw new HttpError(404, "NOT_FOUND", "template not found");
    }
    return reply.send({ data: template });
  });

  app.patch("/notifications/templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = templateIdParam.parse(req.params);
    const body = updateTemplateBody.parse(req.body);
    // UAT W6 P1: unknown / other-tenant template is a 404, not a queued no-op
    // (findTemplateById is not tenant-filtered, hence the tenant comparison).
    const existing = await queries.getTemplate(ctx.tenantId, id);
    if (!existing || existing.tenantId !== ctx.tenantId) throw new HttpError(404, "NOT_FOUND", "template not found");
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
    // Fastify's own 4xx (e.g. FST_ERR_CTP_EMPTY_JSON_BODY: JSON content-type with no body) is a
    // client error, not a 500 (UAT #13).
    const sc = (err as { statusCode?: number }).statusCode;
    if (typeof sc === "number" && sc >= 400 && sc < 500) return reply.code(sc).send({ code: sc === 400 ? "BAD_REQUEST" : "CLIENT_ERROR", message: "invalid request", correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
