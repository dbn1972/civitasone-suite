/**
 * Quotas module HTTP routes (Fastify plugin).
 * Writes return 202. Reads return 200. quotaCheck is synchronous.
 */
import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { quotaSetBody, quotaIncrementBody, quotaCheckBody, tenantIdParam, resourceParam } from "./validators.js";
import * as commands from "./commands.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

const PLATFORM_ADMIN = ["platform_admin", "super_admin"];
const RESOURCE = "quota";

export async function quotaRoutes(app: FastifyInstance): Promise<void> {
  // SET quota limit — platform admin only
  app.post("/v1/quotas", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const body = quotaSetBody.parse(req.body);
    const res = await commands.quotaSet(ctx, body);
    return sendAccepted(reply, acceptedResponseSchema, res);
  });

  // INCREMENT usage — internal service calls
  app.post("/v1/quotas/increment", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = quotaIncrementBody.parse(req.body);
    const res = await commands.quotaIncrement(ctx, body);
    return sendAccepted(reply, acceptedResponseSchema, res);
  });

  // CHECK quota — synchronous read (no queue)
  app.post("/v1/quotas/check", async (req, reply) => {
    resolveContext(req); // auth required
    const body = quotaCheckBody.parse(req.body);
    const result = await commands.quotaCheck(body);
    return reply.send(result);
  });

  // LIST quotas for a tenant
  app.get("/v1/quotas/:tenantId", async (req, reply) => {
    const ctx = resolveContext(req);
    const { tenantId } = tenantIdParam.parse(req.params);
    // cross-tenant guard
    if (ctx.tenantId !== tenantId && !ctx.roles.some((r) => PLATFORM_ADMIN.includes(r))) {
      throw new HttpError(403, "FORBIDDEN", "cross-tenant access denied");
    }
    const quotas = await repo.findAllByTenant(tenantId);
    return reply.send(quotas);
  });

  // GET specific quota for a tenant + resource
  app.get("/v1/quotas/:tenantId/:resource", async (req, reply) => {
    const ctx = resolveContext(req);
    const { tenantId } = tenantIdParam.parse(req.params);
    const { resource } = resourceParam.parse(req.params);
    if (ctx.tenantId !== tenantId && !ctx.roles.some((r) => PLATFORM_ADMIN.includes(r))) {
      throw new HttpError(403, "FORBIDDEN", "cross-tenant access denied");
    }
    const quota = await cache.getOrLoad(
      cache.makeKey(tenantId, RESOURCE, resource),
      async () => repo.findByTenantAndResource(tenantId, resource),
    );
    if (!quota) throw new HttpError(404, "NOT_FOUND", "quota not found");
    return reply.send({
      ...quota,
      usagePercent: repo.usagePercent(quota),
      overLimit: repo.isOverLimit(quota),
    });
  });
}
