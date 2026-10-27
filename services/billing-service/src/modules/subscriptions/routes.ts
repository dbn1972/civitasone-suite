import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { SubscriptionSummarySchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireSuperAdmin, requireRole, HttpError } from "../../shared/context.js";
import { createSubBody, idParam, tenantParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as plansQueries from "../plans/queries.js";

const SUBSCRIPTION_READERS = ["billing_admin", "tenant_admin", "super_admin", "platform_admin"];
const SUMMARY_STATUSES = new Set(["active", "cancelled", "past_due", "suspended", "trial"]);

export async function subscriptionsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/billing/subscriptions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const body = createSubBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createSubscription(ctx, body.tenantId, body.planId));
  });

  app.patch("/v1/billing/subscriptions/:id/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.activateSubscription(ctx, id));
  });

  app.patch("/v1/billing/subscriptions/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.cancelSubscription(ctx, id));
  });

  app.get("/v1/billing/tenants/:id/subscription", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = tenantParam.parse(req.params);
    const sub = await queries.getSubscription(id);
    if (!sub) throw new HttpError(404, "NOT_FOUND", "subscription not found");
    return reply.send(sub);
  });

  // GAP-TENANT-ADMIN-SUBSCRIPTION-06: this is the CALLER's OWN tenant summary
  // (ctx.tenantId, never a body/query id) and it is what the tenant-admin
  // Subscription page reads. It used to be super-admin-only, so a tenant_admin
  // always got 403 on their own subscription page. Read-only; every write route
  // stays super-admin only.
  app.get("/v1/billing/subscriptions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBSCRIPTION_READERS);
    const sub = await queries.getSubscription(ctx.tenantId);
    if (!sub) return reply.send(null);
    // GAP-BILLING-SUBSCRIPTIONS-03: name and price of the plan this subscription is on. A plan
    // lookup failure degrades to unknown (null), never an invented value or a failed summary.
    const plan = await plansQueries.getPlan(sub.planId).catch((err: unknown) => {
      req.log.warn({ err }, "subscription summary: plan lookup failed");
      return null;
    });
    sendValidated(reply, SubscriptionSummarySchema, {
      id: sub.id,
      plan: sub.planId,
      // The consumer also writes "suspended" (dunning); it used to fall through to
      // "trial", showing a suspended tenant a friendly "Trial" pill.
      status: (SUMMARY_STATUSES.has(sub.status) ? sub.status : "trial") as "active" | "past_due" | "cancelled" | "trial" | "suspended",
      // No real billing-period / usage / currency data exists yet: return null
      // (unknown) rather than inventing values. The trial expiry is the only
      // real date we hold.
      currentPeriodStart: null,
      currentPeriodEnd: sub.trialExpiresAt?.slice(0, 10) ?? null,
      activeUsers: null,
      moduleAccess: [],
      currency: plan?.currency ?? null,
      planName: plan?.name ?? null,
      startDate: sub.startedAt?.slice(0, 10) ?? null,
      renewalDate: sub.endsAt?.slice(0, 10) ?? null,
      amountMinor: plan ? plan.priceMinor : null,
    });
  });

  // GAP-BILLING-SUBSCRIPTIONS-03: the caller's OWN tenant subscription history (active and past),
  // newest first, for the tenant-admin Subscriptions table. Read-only; the tenant is always
  // ctx.tenantId, never a query/body id, so another tenant's rows can never be listed.
  app.get("/v1/billing/subscriptions/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBSCRIPTION_READERS);
    const rows = await queries.listSubscriptionHistory(ctx.tenantId);
    const planIds = [...new Set(rows.map((r) => r.planId))];
    const plans = new Map<string, Awaited<ReturnType<typeof plansQueries.getPlan>> | null>();
    await Promise.all(planIds.map(async (id) => {
      // A plan lookup failure degrades to unknown (null), never an invented value or a failed list.
      plans.set(id, await plansQueries.getPlan(id).catch((err: unknown) => {
        req.log.warn({ err }, "subscription history: plan lookup failed");
        return null;
      }));
    }));
    return reply.send({
      data: rows.map((r) => {
        const plan = plans.get(r.planId) ?? null;
        return {
          id: r.id,
          plan: r.planId,
          planName: plan?.name ?? null,
          status: r.status,
          startDate: r.startedAt.slice(0, 10),
          renewalDate: r.endsAt?.slice(0, 10) ?? null,
          amountMinor: plan ? plan.priceMinor : null,
          currency: plan?.currency ?? null,
        };
      }),
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
