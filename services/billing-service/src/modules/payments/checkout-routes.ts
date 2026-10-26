import { SYSTEM_ACTOR_ID } from "@civitasone/outbox";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { checkoutBody, verifyPaymentBody } from "./checkout-validators.js";
import * as razorpay from "./razorpay.js";
import { captureRawBody, providerEventMessageId, razorpayEventParts, razorpayEventTenant, type RawBodyRequest } from "../gateways/webhook-verify.js";

export async function checkoutRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/billing/checkout
   * Creates a Razorpay order for the frontend Checkout.js flow.
   * This is a synchronous call (creates external order, no DB write) and
   * returns the order_id directly.
   */
  app.post("/v1/billing/checkout", { config: { rateLimit: { max: 30, timeWindow: "1 minute", keyGenerator: (r: FastifyRequest) => (r as { ctx?: { actorId?: string } }).ctx?.actorId ?? r.ip } } }, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);

    const body = checkoutBody.parse(req.body);

    // Publish a checkoutCreate command for audit trail and
    // call Razorpay directly since this is an external order creation.
    const receipt = `checkout-${ctx.tenantId}-${Date.now()}`;

    // Look up plan price — for the MVP we pass it from the frontend via the
    // plan lookup. The plan lookup happens here server-side for security.
    const { eq } = await import("drizzle-orm");
    const { scopedRead } = await import("../../shared/db.js");
    const { billingPlans } = await import("../plans/schema.js");

    const [plan] = await scopedRead((tx) => tx
      .select({ priceMinor: billingPlans.priceMinor, currency: billingPlans.currency })
      .from(billingPlans)
      .where(eq(billingPlans.id, body.planId))
      .limit(1));

    if (!plan) {
      throw new HttpError(404, "PLAN_NOT_FOUND", `plan ${body.planId} not found`);
    }

    // GAP2-BILLING-CHECKOUT-01: keep the charged amount in BigInt paise. Previously
    // this multiplied a float-coerced price by (annual ? 12 : 1) — IEEE-754 float
    // math on money, which loses integer precision above Number.MAX_SAFE_INTEGER paise
    // (CLAUDE.md §3.11 / §4). plan.priceMinor is a bigint; multiply with bigint
    // literals and serialise to a string only at the response/audit boundary.
    const amountPaise = BigInt(plan.priceMinor) * (body.billingCycle === "annual" ? 12n : 1n);
    const amountPaiseStr = amountPaise.toString();
    const currency = plan.currency ?? "INR";

    const order = await razorpay.createOrder(amountPaise, currency, receipt, {
      tenantId: ctx.tenantId,
      planId: body.planId,
      billingCycle: body.billingCycle,
    });

    // Publish audit command (fire-and-forget, non-blocking)
    queue.publish(COMMANDS.checkoutCreate, {
      messageId: randomUUID(),
      type: COMMANDS.checkoutCreate,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        razorpayOrderId: order.id,
        planId: body.planId,
        billingCycle: body.billingCycle,
        amountPaise: amountPaiseStr,
        currency,
      },
    }).catch(() => {/* best-effort audit */});

    return reply.code(200).send({
      orderId: order.id,
      amountPaise: amountPaiseStr,
      currency,
      keyId: razorpay.getPublicKeyId(),
    });
  });

  /**
   * POST /v1/billing/payments/verify
   * Verifies the Razorpay payment signature returned by Checkout.js.
   * On success, publishes a command to confirm the payment asynchronously.
   */
  app.post("/v1/billing/payments/verify", { config: { rateLimit: { max: 30, timeWindow: "1 minute", keyGenerator: (r: FastifyRequest) => (r as { ctx?: { actorId?: string } }).ctx?.actorId ?? r.ip } } }, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);

    const body = verifyPaymentBody.parse(req.body);

    const valid = razorpay.verifyPaymentSignature(
      body.razorpayOrderId,
      body.razorpayPaymentId,
      body.razorpaySignature,
    );

    if (!valid) {
      throw new HttpError(400, "INVALID_SIGNATURE", "payment signature verification failed");
    }

    const messageId = randomUUID();
    await queue.publish(COMMANDS.checkoutVerify, {
      messageId,
      type: COMMANDS.checkoutVerify,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        razorpayOrderId: body.razorpayOrderId,
        razorpayPaymentId: body.razorpayPaymentId,
        razorpaySignature: body.razorpaySignature,
      },
    });

    return reply.code(202).send({
      id: messageId,
      status: "accepted",
      correlationId: ctx.correlationId,
    });
  });

  /**
   * POST /v1/billing/webhooks/razorpay
   * PUBLIC route (config.public -- a gateway callback carries no bearer token); the HMAC over the
   * RAW request bytes is the authentication. Publishes to the queue for async processing.
   */
  app.post("/v1/billing/webhooks/razorpay", { config: { public: true, rateLimit: { max: 300, timeWindow: "1 minute", keyGenerator: (r: FastifyRequest) => `webhook:${r.ip}` } }, preParsing: captureRawBody }, async (req, reply) => {
    const signature = req.headers["x-razorpay-signature"] as string | undefined;
    if (!signature) {
      throw new HttpError(400, "MISSING_SIGNATURE", "x-razorpay-signature header is required");
    }

    const rawBody = (req as RawBodyRequest).rawBody;
    if (typeof rawBody !== "string" || rawBody === "") {
      throw new HttpError(401, "UNAUTHORIZED", "unauthorized");
    }
    const valid = razorpay.verifyWebhookSignature(rawBody, signature);

    if (!valid) {
      throw new HttpError(401, "UNAUTHORIZED", "unauthorized");
    }

    const webhookPayload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // Dedupe by provider event id (signed body fields), so a retried delivery is a consumer no-op.
    const messageId = providerEventMessageId("razorpay", ...razorpayEventParts(webhookPayload));
    await queue.publish(COMMANDS.webhookRazorpay, {
      messageId,
      type: COMMANDS.webhookRazorpay,
      tenantId: razorpayEventTenant(webhookPayload), // from the signed order notes; "system" if absent
      actorId: SYSTEM_ACTOR_ID,
      correlationId: messageId,
      schemaVersion: "1.0",
      payload: webhookPayload,
    });

    return reply.code(200).send({ status: "ok" });
  });

  // Error handler scoped to checkout routes
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    // @fastify/rate-limit throws a plain object with statusCode 429; without this branch it would fall through to 500.
    if ((err as { statusCode?: number }).statusCode === 429) {
      const retryAfter = (err as { retryAfter?: number }).retryAfter ?? 60;
      return reply.code(429).header("retry-after", String(retryAfter)).send({ code: "RATE_LIMITED", message: "rate limit exceeded", correlationId, retryable: true, retryAfter });
    }
    req.log.error({ err }, "unhandled error in checkout routes");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
