/**
 * Multi-gateway payment routes.
 *
 * Routes:
 *   POST /v1/billing/payments/initiate   — Create a payment order via configured gateway
 *   GET  /v1/billing/payments/:id/status — Check payment status
 *   POST /v1/billing/payments/:id/capture — Capture an authorized payment
 *
 * Requirements: 13.4, 13.5, 13.6, 13.7, 13.8
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { initiatePaymentBody, paymentIdParam } from "./validators.js";
import * as gateways from "./index.js";
import * as upiAutopay from "./upi-autopay.js";
import { GatewayError } from "./types.js";

const BILLING_ROLES = ["billing_admin", "finance_officer", "tenant_admin", "super_admin", "platform_admin"];

export async function gatewayRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/billing/payments/initiate
   *
   * Creates a payment order on the configured gateway.
   * Supports three methods: gateway (Razorpay/PayU/CCAvenue), upi_autopay, emandate.
   */
  app.post("/v1/billing/payments/initiate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BILLING_ROLES);

    const body = initiatePaymentBody.parse(req.body);

    if (body.method === "upi_autopay") {
      // UPI autopay execution against an existing mandate
      if (!body.mandateId) {
        throw new HttpError(400, "MANDATE_ID_REQUIRED", "mandateId is required for upi_autopay method");
      }
      const result = await upiAutopay.executeUpiPayment({
        mandateId: body.mandateId,
        amountPaise: BigInt(body.amountPaise),
        tenantId: ctx.tenantId,
      });

      // Publish audit command
      await publishPaymentCommand(ctx, {
        method: "upi_autopay",
        mandateId: body.mandateId,
        amountPaise: body.amountPaise,
        executionId: result.executionId,
      });

      return reply.code(202).send({
        data: {
          executionId: result.executionId,
          mandateId: result.mandateId,
          amount: result.amount.toString(),
          status: result.status,
        },
        correlationId: ctx.correlationId,
      });
    }

    if (body.method === "emandate") {
      // e-mandate debit against an existing mandate
      if (!body.mandateId) {
        throw new HttpError(400, "MANDATE_ID_REQUIRED", "mandateId is required for emandate method");
      }
      const result = await upiAutopay.executeEmandateDebit({
        mandateId: body.mandateId,
        amountPaise: BigInt(body.amountPaise),
        tenantId: ctx.tenantId,
      });

      await publishPaymentCommand(ctx, {
        method: "emandate",
        mandateId: body.mandateId,
        amountPaise: body.amountPaise,
        executionId: result.executionId,
      });

      return reply.code(202).send({
        data: {
          executionId: result.executionId,
          mandateId: result.mandateId,
          amount: result.amount.toString(),
          status: result.status,
        },
        correlationId: ctx.correlationId,
      });
    }

    // Default: gateway (Razorpay/PayU/CCAvenue based on PAYMENT_GATEWAY env)
    const order = await gateways.createOrder(
      BigInt(body.amountPaise),
      body.currency,
      {
        tenantId: ctx.tenantId,
        invoiceId: body.invoiceId,
        subscriptionId: body.subscriptionId,
      },
    );

    await publishPaymentCommand(ctx, {
      method: "gateway",
      gateway: order.gateway,
      gatewayOrderId: order.gatewayOrderId,
      amountPaise: body.amountPaise,
      currency: body.currency,
    });

    return reply.code(202).send({
      data: {
        gatewayOrderId: order.gatewayOrderId,
        gateway: order.gateway,
        amount: order.amount.toString(),
        currency: order.currency,
        status: order.status,
      },
      correlationId: ctx.correlationId,
    });
  });

  /**
   * GET /v1/billing/payments/:id/status
   *
   * Check the status of a payment on the configured gateway.
   */
  app.get("/v1/billing/payments/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BILLING_ROLES);

    const { id } = paymentIdParam.parse(req.params);
    const status = await gateways.checkStatus(id);

    return reply.code(200).send({
      data: {
        gatewayOrderId: status.gatewayOrderId,
        gateway: status.gateway,
        status: status.status,
        amountPaise: status.amountPaise.toString(),
        currency: status.currency,
        method: status.method,
        errorCode: status.errorCode,
        errorMessage: status.errorMessage,
        updatedAt: status.updatedAt,
      },
    });
  });

  /**
   * POST /v1/billing/payments/:id/capture
   *
   * Capture an authorized payment on the configured gateway.
   */
  app.post("/v1/billing/payments/:id/capture", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BILLING_ROLES);

    const { id } = paymentIdParam.parse(req.params);
    const result = await gateways.capturePayment(id);

    await publishPaymentCommand(ctx, {
      method: "gateway",
      gateway: result.gateway,
      gatewayOrderId: result.gatewayOrderId,
      amountPaise: Number(result.capturedAmount),
      status: result.status,
    });

    return reply.code(200).send({
      data: {
        gatewayOrderId: result.gatewayOrderId,
        gateway: result.gateway,
        capturedAmount: result.capturedAmount.toString(),
        currency: result.currency,
        status: result.status,
        capturedAt: result.capturedAt,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      },
    });
  });

  // Error handler for gateway routes
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;

    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: { code: "VALIDATION_FAILED", message: "invalid request", details: err.flatten(), correlationId },
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({
        error: { code: err.code, message: err.message, correlationId },
      });
    }
    if (err instanceof GatewayError) {
      // PAYMENT_METHOD_UNAVAILABLE is a business rule rejection (422)
      // 4xx from upstream = client error (422)
      // 5xx/timeout from upstream = bad gateway (502)
      const status = err.code === "PAYMENT_METHOD_UNAVAILABLE" ? 422
        : err.isClientError ? 422
        : 502;
      return reply.code(status).send({
        error: {
          code: err.code,
          message: err.message,
          correlationId,
          gateway: err.gateway,
        },
      });
    }
    if (err instanceof CircuitBreakerOpenError) {
      return reply.code(503).send({
        error: {
          code: "GATEWAY_CIRCUIT_OPEN",
          message: "Payment gateway is temporarily unavailable",
          correlationId,
        },
      });
    }
    req.log.error({ err, correlationId }, "unhandled error in gateway routes");
    return reply.code(500).send({
      error: { code: "INTERNAL", message: "internal error", correlationId },
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────

async function publishPaymentCommand(
  ctx: { tenantId: string; actorId: string; correlationId: string },
  payload: Record<string, unknown>,
): Promise<void> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.paymentRecord, {
    messageId,
    type: COMMANDS.paymentRecord,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  }).catch(() => {/* best-effort audit trail */});
}
