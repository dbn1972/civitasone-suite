import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { SubscriptionSummarySchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireSuperAdmin, HttpError } from "../../shared/context.js";
import { createSubBody, idParam, tenantParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

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

  app.get("/v1/billing/subscriptions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const sub = await queries.getSubscription(ctx.tenantId);
    if (!sub) return reply.send(null);
    sendValidated(reply, SubscriptionSummarySchema, {
      id: sub.id,
      plan: sub.planId,
      status: (sub.status === "active" ? "active" : sub.status === "cancelled" ? "cancelled" : sub.status === "past_due" ? "past_due" : "trial") as "active" | "past_due" | "cancelled" | "trial",
      currentPeriodStart: new Date().toISOString().slice(0, 10),
      currentPeriodEnd: sub.trialExpiresAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      activeUsers: 0,
      moduleAccess: [],
      currency: "INR",
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
