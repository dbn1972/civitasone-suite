/**
 * Subscriptions module HTTP routes (Fastify plugin).
 * Writes return 202. Reads return 200 from cache.
 */
import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createSubscriptionBody,
  upgradeSubscriptionBody,
  cancelSubscriptionBody,
  renewSubscriptionBody,
  suspendSubscriptionBody,
  subscriptionIdParam,
  tenantIdParam,
} from "./validators.js";
import * as commands from "./commands.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

const PLATFORM_ADMIN = ["platform_admin", "super_admin"];
const ADMIN_ROLES = [...PLATFORM_ADMIN, "tenant_admin"];
const RESOURCE = "subscription";

export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  // CREATE subscription
  app.post("/v1/subscriptions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const body = createSubscriptionBody.parse(req.body);
    const res = await commands.subscriptionCreate(ctx, body);
    return sendAccepted(reply, acceptedResponseSchema, res);
  });

  // GET subscription by id (cache-first)
  app.get("/v1/subscriptions/:subscriptionId", async (req, reply) => {
    const ctx = resolveContext(req);
    const { subscriptionId } = subscriptionIdParam.parse(req.params);
    const view = await cache.getOrLoad(
      cache.makeKey(ctx.tenantId, RESOURCE, subscriptionId),
      async () => repo.findById(subscriptionId),
    );
    if (!view) throw new HttpError(404, "NOT_FOUND", "subscription not found");
    return reply.send(view);
  });

  // GET current tenant's subscription
  app.get("/v1/subscriptions/current", async (req, reply) => {
    const ctx = resolveContext(req);
    if (!ctx.tenantId) throw new HttpError(401, "UNAUTHENTICATED", "no tenant in context");
    const view = await repo.findByTenantId(ctx.tenantId);
    if (!view) throw new HttpError(404, "NOT_FOUND", "subscription not found");
    return reply.send(view);
  });

  // UPGRADE subscription
  app.post("/v1/subscriptions/:subscriptionId/upgrade", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { subscriptionId } = subscriptionIdParam.parse(req.params);
    const body = upgradeSubscriptionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.subscriptionUpgrade(ctx, subscriptionId, body));
  });

  // CANCEL subscription
  app.post("/v1/subscriptions/:subscriptionId/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { subscriptionId } = subscriptionIdParam.parse(req.params);
    const body = cancelSubscriptionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.subscriptionCancel(ctx, subscriptionId, body));
  });

  // RENEW subscription
  app.post("/v1/subscriptions/:subscriptionId/renew", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const { subscriptionId } = subscriptionIdParam.parse(req.params);
    const body = renewSubscriptionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.subscriptionRenew(ctx, subscriptionId, body));
  });

  // SUSPEND subscription
  app.post("/v1/subscriptions/:subscriptionId/suspend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const { subscriptionId } = subscriptionIdParam.parse(req.params);
    const body = suspendSubscriptionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.subscriptionSuspend(ctx, subscriptionId, body));
  });
}
