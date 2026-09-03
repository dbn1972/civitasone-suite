import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { tenantModulesResponseSchema } from "@civitasone/schemas/web";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireSuperAdmin, requireRole, HttpError } from "../../shared/context.js";
import { tenantIdParam, moduleParam, moduleKeyParam, toggleBody, createFlagBody, overrideFlagBody, flagKeyParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const TENANT_ADMIN = ["tenant_admin", "super_admin", "platform_admin"];

export async function configRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/tenant/modules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TENANT_ADMIN);
    sendValidated(reply, tenantModulesResponseSchema, { data: await queries.listTenantModules(ctx.tenantId) });
  });

  // Tenant-admin module toggle (P0 — settings "Save changes" could not persist).
  // Scoped to the CALLER's own tenant (ctx.tenantId) — a tenant_admin can toggle
  // modules for their tenant only; cross-tenant toggling stays on the
  // super-admin-only PATCH /v1/admin/tenants/:id/modules/:module/toggle route
  // below. Enqueues the existing admin.module.toggle command (idempotent on the
  // command id) which the config consumer applies + audits via the outbox.
  app.post("/v1/admin/tenant/modules/:key/toggle", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TENANT_ADMIN);
    const { key } = moduleKeyParam.parse(req.params);
    const body = toggleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.toggleModule(ctx, ctx.tenantId, key, body.enabled));
  });

  app.get("/v1/admin/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TENANT_ADMIN);
    const config = await queries.getConfig(ctx.tenantId);
    if (!config) throw new HttpError(404, "NOT_FOUND", "tenant config not found");
    return reply.send(config);
  });

  app.get("/v1/admin/tenants/:id/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = tenantIdParam.parse(req.params);
    const config = await queries.getConfig(id);
    if (!config) throw new HttpError(404, "NOT_FOUND", "tenant config not found");
    return reply.send(config);
  });

  app.patch("/v1/admin/tenants/:id/modules/:module/toggle", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id, module } = moduleParam.parse(req.params);
    const body = toggleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.toggleModule(ctx, id, module, body.enabled));
  });

  app.post("/v1/admin/feature-flags", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const body = createFlagBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createFeatureFlag(ctx, body.flagKey, body.enabled));
  });

  app.patch("/v1/admin/feature-flags/:key/override", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { key } = flagKeyParam.parse(req.params);
    const body = overrideFlagBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.overrideFeatureFlag(ctx, key, body.tenantId, body.enabled));
  });

  app.get("/v1/admin/feature-flags", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 100));
    const offset = Math.max(0, Number(q.offset) || 0);
    const all = (await queries.listFeatureFlags()) ?? [];
    return reply.send(all.slice(offset, offset + limit));
  });

  // Internal endpoint for gateway module enforcement (service-to-service).
  // Authenticates via INTERNAL_SERVICE_SECRET header — no user JWT required.
  // Falls back to super-admin auth if internal secret not provided.
  //
  // Defense-in-depth (follow-up to gateway-service#986): a valid shared secret
  // ALONE is not a reliable "this is a genuine machine caller" signal — the
  // secret can end up attached to ordinary client-forwarded traffic (as the
  // gateway's proxyHandler briefly did). We therefore also require the
  // explicit `x-internal: "1"` flag, mirroring the pattern already used
  // correctly by policy-service (`evaluate/routes.ts`) and crm-service
  // (`contacts/routes.ts`) — a proxy would never set this flag on an ordinary
  // forwarded client request. Secret-only or flag-only requests fall through
  // to the normal role-based auth path below, they are never auto-rejected.
  app.get("/v1/admin/tenants/:id/modules-list", async (req, reply) => {
    const secret = req.headers["x-internal-secret"] as string | undefined;
    const hasInternalFlag = req.headers["x-internal"] === "1";
    const expected = process.env.INTERNAL_SERVICE_SECRET;
    // If INTERNAL_SERVICE_SECRET is not configured, treat as internal (dev/test mode)
    const secretNotConfigured = typeof expected !== "string" || expected.length === 0;
    const isValidInternal = !secretNotConfigured && hasInternalFlag &&
      typeof secret === "string" && secret.length === expected.length &&
      timingSafeEqual(Buffer.from(secret, "utf8"), Buffer.from(expected, "utf8"));
    if (!isValidInternal && !secretNotConfigured) {
      // Fall back to normal auth if not internal and secret is configured
      const ctx = resolveContext(req);
      requireSuperAdmin(ctx);
    }
    const { id } = tenantIdParam.parse(req.params);
    const modules = await queries.listTenantModules(id);
    return reply.send({ data: modules });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
