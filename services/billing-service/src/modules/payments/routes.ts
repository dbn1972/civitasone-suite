import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireSuperAdmin, requireRole, HttpError } from "../../shared/context.js";
import { recordPaymentBody, invoiceParam, tenantParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const BILLING_ROLES = ["billing_admin", "tenant_admin", "super_admin", "platform_admin"];

export async function paymentsRoutes(app: FastifyInstance): Promise<void> {
  // Record a payment receipt against a bill.
  app.post("/v1/billing/payments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const body = recordPaymentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordPayment(ctx, body));
  });

  // Read model: receipts against a bill.
  app.get("/v1/billing/invoices/:id/payments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = invoiceParam.parse(req.params);
    return reply.send(await queries.listReceiptsForInvoice(id, ctx.tenantId));
  });

  // Read model: all receipts for a tenant.
  app.get("/v1/billing/tenants/:id/payments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = tenantParam.parse(req.params);
    return reply.send(await queries.listReceiptsForTenant(id));
  });

  // Caller-scoped list: returns payments for the authenticated user's tenant.
  app.get("/v1/billing/payments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BILLING_ROLES);
    return reply.send(await queries.listReceiptsForTenant(ctx.tenantId));
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
