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
  upgradeInitiateBody,
  downgradeRequestBody,
  downgradeDecisionBody,
  downgradeRequestIdParam,
  cancelSubscriptionSelfBody,
} from "./validators.js";
import * as plansRepo from "../plans/repo.js";
import * as quotasRepo from "../quotas/repo.js";
import { exceededLimits, isDowngrade } from "./downgrade.js";
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
    resolveContext(req);
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

  // POST request a downgrade (owner decision #24). NOT self-serve: this only
  // records a request with a reason; platform billing approves it. It is refused
  // (409) when the tenant's live usage exceeds the target plan's limits, so the
  // admin sees a blocking message instead of a request that could never be applied.
  app.post("/v1/tenant/subscription/downgrade", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const parsed = downgradeRequestBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const sub = await repo.findByTenantIdScoped(ctx.tenantId);
    if (!sub) throw new HttpError(404, "NOT_FOUND", "no active subscription");
    const [current, target] = await Promise.all([plansRepo.findByIdScoped(ctx.tenantId, sub.planId), plansRepo.findByIdScoped(ctx.tenantId, parsed.data.targetPlanId)]);
    if (!target || target.tenantId !== ctx.tenantId) throw new HttpError(404, "PLAN_NOT_FOUND", "the target plan does not exist");
    if (target.id === sub.planId) throw new HttpError(409, "SAME_PLAN", "you are already on this plan");
    if (current && !isDowngrade(current, target)) throw new HttpError(409, "NOT_A_DOWNGRADE", "the target plan is not cheaper than the current plan; use the upgrade request instead");
    const quotas = await quotasRepo.findAllByTenantScoped(ctx.tenantId);
    const used = (r: string) => quotas.find((q) => q.resource === r)?.used ?? 0;
    const over = exceededLimits({ users: used("users"), storage_gb: used("storage_gb") }, target);
    if (over.length > 0) {
      return reply.code(409).send({
        code: "USAGE_EXCEEDS_TARGET_PLAN",
        message: "current usage is above the limits of the target plan; reduce usage before requesting this downgrade",
        details: over,
        correlationId: ctx.correlationId,
      });
    }
    if (await repo.findPendingDowngrade(ctx.tenantId)) throw new HttpError(409, "REQUEST_ALREADY_PENDING", "a downgrade request is already awaiting approval");
    const result = await commands.subscriptionDowngradeRequest(ctx, {
      subscriptionId: sub.id, fromPlanId: sub.planId, targetPlanId: target.id, reason: parsed.data.reason,
      usage: { checks: [{ resource: "users", used: used("users"), limit: target.maxUsers }, { resource: "storage_gb", used: used("storage_gb"), limit: target.maxStorageGb }] },
    });
    return reply.code(202).send(result);
  });

  // GET the tenant's own downgrade requests (pending state for the plans page).
  app.get("/v1/tenant/subscription/downgrade-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    return reply.send({ data: await repo.listDowngradeRequests(ctx.tenantId) });
  });

  // GET platform billing's queue: pending requests across tenants.
  app.get("/v1/tenant/subscription/downgrade-requests/pending", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    return reply.send({ data: await repo.listPendingDowngradesForPlatform() });
  });

  // POST platform billing approves or rejects. The requester can never decide their
  // own request (enforced here, again in the consumer, and by a CHECK in the table).
  app.post("/v1/tenant/subscription/downgrade-requests/:requestId/decision", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const { requestId } = downgradeRequestIdParam.parse(req.params);
    const parsed = downgradeDecisionBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const request = await repo.findDowngradeRequest(parsed.data.tenantId, requestId);
    if (!request) throw new HttpError(404, "NOT_FOUND", "downgrade request not found");
    if (request.status !== "pending") throw new HttpError(409, "ALREADY_DECIDED", `this request is already ${request.status}`);
    if (request.requestedBy === ctx.actorId) throw new HttpError(403, "SELF_APPROVAL", "you cannot decide a downgrade you requested");
    const result = await commands.subscriptionDowngradeDecision(ctx, { requestId, tenantId: parsed.data.tenantId, decision: parsed.data.decision, reason: parsed.data.reason });
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
