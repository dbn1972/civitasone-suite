/**
 * Quotas module HTTP routes (Fastify plugin).
 * Writes return 202. Reads return 200. quotaCheck is synchronous.
 */
import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, requireInternalOrRoles, HttpError } from "../../shared/context.js";
import { quotaSetBody, quotaIncrementBody, quotaCheckBody, tenantIdParam, resourceParam } from "./validators.js";
import * as commands from "./commands.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

const PLATFORM_ADMIN = ["platform_admin", "super_admin"];
// SEC-016: the two "internal service calls" routes below used to gate on
// `requireRole(ctx, [...PLATFORM_ADMIN, "service_account"])`. The
// "service_account" entry never actually matches ctx.roles (see
// shared/context.ts's requireInternalOrRoles), so their real gate was
// PLATFORM_ADMIN alone — including bare `super_admin`, a role a human can
// hold, on routes documented as internal-only. `platform_admin` is kept: it's
// the same distinct human role already relied on one route above (`POST
// /v1/quotas`, "platform admin only") for the strictly more powerful SET
// operation, so allowing it here too is not a new grant. A genuine internal
// caller is now recognised via ctx.actorType directly instead of the dead
// "service_account" string.
const INTERNAL_INCREMENT_ROLES = ["platform_admin"];
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

  // INCREMENT usage — internal service calls, or platform_admin (see SEC-016 note above)
  app.post("/v1/quotas/increment", async (req, reply) => {
    const ctx = resolveContext(req);
    requireInternalOrRoles(ctx, INTERNAL_INCREMENT_ROLES);
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

  // GET full usage dashboard for current tenant (all resources)
  app.get("/v1/tenant/usage", async (req, reply) => {
    const ctx = resolveContext(req);
    const quotas = await repo.findAllByTenant(ctx.tenantId);
    const resources = quotas.map((q) => ({
      resource: q.resource,
      limit: q.limit,
      used: q.used,
      usagePercent: repo.usagePercent(q),
      overLimit: repo.isOverLimit(q),
      projectedOverageDate: repo.projectedOverageDate(q, Math.max(1, Math.round(q.used / 30)))?.toISOString() ?? null,
    }));
    const anyOverLimit = resources.some((r) => r.overLimit);
    const anyWarning = resources.some((r) => r.usagePercent >= 90);
    return reply.send({ tenantId: ctx.tenantId, resources, anyOverLimit, anyWarning });
  });

  // POST increment usage — internal service calls, or platform_admin (see SEC-016 note above)
  app.post("/v1/tenant/usage/increment", async (req, reply) => {
    const ctx = resolveContext(req);
    requireInternalOrRoles(ctx, INTERNAL_INCREMENT_ROLES);
    const body = quotaIncrementBody.parse(req.body);
    const res = await commands.quotaIncrement(ctx, body);
    return sendAccepted(reply, acceptedResponseSchema, res);
  });
}
