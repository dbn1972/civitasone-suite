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
  upgradeInitiateBody,
  downgradeBody,
  cancelSubscriptionSelfBody,
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

  // ══════════════════════════════════════════════════════════════════════════
  // Self-Service Plan Upgrade Routes
  // ══════════════════════════════════════════════════════════════════════════

  // GET available plans with pricing & feature comparison
  app.get("/v1/tenant/plans", async (req, reply) => {
    const ctx = resolveContext(req);
    // Available to all authenticated users (to show plan comparison)
    const plans = [
      {
        id: "plan-small-office", name: "Small Office", pricePerMonth: 999900,
        currency: "INR", maxUsers: 100, storageGb: 50, maxApiCalls: 10000,
        modules: ["finance", "hrms", "payroll", "helpdesk", "knowledge"],
      },
      {
        id: "plan-psu", name: "PSU", pricePerMonth: 4999900,
        currency: "INR", maxUsers: 2000, storageGb: 500, maxApiCalls: 100000,
        modules: ["finance", "hrms", "payroll", "procurement", "contract", "asset", "helpdesk", "knowledge", "projects", "inventory"],
      },
      {
        id: "plan-govt", name: "Govt Department", pricePerMonth: 9999900,
        currency: "INR", maxUsers: 10000, storageGb: 2000, maxApiCalls: 500000,
        modules: ["finance", "hrms", "payroll", "procurement", "contract", "asset", "helpdesk", "knowledge", "projects", "inventory", "grant", "citizen", "legal", "crm", "estab"],
      },
    ];
    return reply.send({ data: plans });
  });

  // GET current subscription details
  app.get("/v1/tenant/subscription/current", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const view = await repo.findByTenantId(ctx.tenantId);
    if (!view) throw new HttpError(404, "NOT_FOUND", "no active subscription");
    return reply.send({ data: view });
  });

  // POST initiate upgrade (creates Razorpay order)
  app.post("/v1/tenant/subscription/upgrade", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const parsed = upgradeInitiateBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const result = await commands.subscriptionUpgradeInitiate(ctx, parsed.data);
    return reply.code(202).send(result);
  });

  // POST initiate downgrade
  app.post("/v1/tenant/subscription/downgrade", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const parsed = downgradeBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const result = await commands.subscriptionDowngrade(ctx, { targetPlanId: parsed.data.targetPlanId });
    return reply.code(202).send(result);
  });

  // POST cancel subscription (self-service)
  app.post("/v1/tenant/subscription/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const parsed = cancelSubscriptionSelfBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const result = await commands.subscriptionCancelSelf(ctx, parsed.data);
    return reply.code(202).send(result);
  });

  // GET invoice history — fetches from billing-service
  app.get("/v1/tenant/subscription/invoice-history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);

    const billingUrl = process.env.BILLING_SERVICE_URL ?? "http://127.0.0.1:3028";
    try {
      const res = await fetch(`${billingUrl}/v1/billing/invoices?limit=50`, {
        headers: {
          "x-internal": "1",
          "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
          "x-tenant-id": ctx.tenantId,
          "x-correlation-id": ctx.correlationId,
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return reply.send({ data: [] });
      const body = await res.json() as { data?: unknown[] };
      return reply.send({ data: body.data ?? [] });
    } catch {
      // billing-service unreachable — return empty (degraded, not broken)
      return reply.send({ data: [] });
    }
  });
}
