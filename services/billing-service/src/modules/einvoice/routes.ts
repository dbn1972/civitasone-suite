import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam, cancelIrnBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const BILLING_ROLES = ["billing_admin", "tenant_admin", "super_admin", "platform_admin"];

export async function einvoiceRoutes(app: FastifyInstance): Promise<void> {
  // Trigger e-invoice (IRN) generation for an existing billing invoice.
  app.post("/v1/billing/invoices/:id/generate-irn", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BILLING_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.generateEInvoice(ctx, id));
  });

  // Cancel an existing IRN (within 24h per NIC rules).
  app.post("/v1/billing/invoices/:id/cancel-irn", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BILLING_ROLES);
    const { id } = idParam.parse(req.params);
    const body = cancelIrnBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.cancelEInvoice(ctx, id, body.reason));
  });

  // Get e-invoice status + QR code for an invoice.
  app.get("/v1/billing/invoices/:id/einvoice", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BILLING_ROLES);
    const { id } = idParam.parse(req.params);
    const einvoice = await queries.getEInvoiceByInvoiceId(id, ctx.tenantId);
    if (!einvoice) throw new HttpError(404, "NOT_FOUND", "e-invoice not found for this invoice");
    return reply.send(einvoice);
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
