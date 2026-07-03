/**
 * Settings module HTTP routes (Fastify plugin).
 * Writes return 202. Reads return 200 from cache.
 */
import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { settingUpsertBody, settingDeleteBody, tenantIdParam, settingKeyParam } from "./validators.js";
import * as commands from "./commands.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

const ADMIN_ROLES = ["platform_admin", "super_admin", "tenant_admin"];
const RESOURCE = "setting";

export async function settingRoutes(app: FastifyInstance): Promise<void> {
  // UPSERT setting
  app.put("/v1/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = settingUpsertBody.parse(req.body);
    const res = await commands.settingUpsert(ctx, body);
    return sendAccepted(reply, acceptedResponseSchema, res);
  });

  // DELETE setting
  app.delete("/v1/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = settingDeleteBody.parse(req.body);
    const res = await commands.settingDelete(ctx, body);
    return sendAccepted(reply, acceptedResponseSchema, res);
  });

  // LIST all settings for current tenant
  app.get("/v1/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    if (!ctx.tenantId) throw new HttpError(401, "UNAUTHENTICATED", "no tenant in context");
    const settings = await repo.findAllByTenant(ctx.tenantId);
    return reply.send(settings);
  });

  // GET specific setting by key (cache-first)
  app.get("/v1/settings/:key", async (req, reply) => {
    const ctx = resolveContext(req);
    if (!ctx.tenantId) throw new HttpError(401, "UNAUTHENTICATED", "no tenant in context");
    const { key } = settingKeyParam.parse(req.params);
    const view = await cache.getOrLoad(
      cache.makeKey(ctx.tenantId, RESOURCE, key),
      async () => repo.findByTenantAndKey(ctx.tenantId, key),
    );
    if (!view) throw new HttpError(404, "NOT_FOUND", "setting not found");
    return reply.send(view);
  });

  // GET settings for a specific tenant (admin cross-tenant read)
  app.get("/v1/settings/tenant/:tenantId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["platform_admin", "super_admin"]);
    const { tenantId } = tenantIdParam.parse(req.params);
    const settings = await repo.findAllByTenant(tenantId);
    return reply.send(settings);
  });
}
