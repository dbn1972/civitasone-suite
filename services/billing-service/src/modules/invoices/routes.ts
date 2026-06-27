import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireSuperAdmin, requireRole, HttpError } from "../../shared/context.js";
import { DomainError } from "./domain.js";
import {
  generateBody, createInvoiceBody, cancelBody, approveBody,
  idParam, approvalIdParam, tenantParam,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const BILLING_ROLES = ["billing_admin", "tenant_admin", "super_admin", "platform_admin"];

export async function invoicesRoutes(app: FastifyInstance): Promise<void> {
  // Legacy: auto-generate a usage bill from plan + usage.
  app.post("/v1/billing/invoices/generate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const body = generateBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.generateInvoice(ctx, body.tenantId, body.periodMonth));
  });

  // Create a draft bill from explicit line items (incl. tax / charge lines).
  app.post("/v1/billing/invoices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const body = createInvoiceBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createInvoice(ctx, body.tenantId, body.periodMonth, body.items));
  });

  // Request issue (maker step; maker-checker routes value-significant bills to approval).
  app.patch("/v1/billing/invoices/:id/issue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = idParam.parse(req.params);
    const inv = await queries.getInvoiceForPayment(id, ctx.tenantId);
    if (!inv) throw new HttpError(404, "NOT_FOUND", "invoice not found");
    return reply.code(202).send(await commands.requestIssue(ctx, id, inv.totalMinor));
  });

  // Request cancel (maker step).
  app.patch("/v1/billing/invoices/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = idParam.parse(req.params);
    const body = cancelBody.parse(req.body);
    const inv = await queries.getInvoiceForPayment(id, ctx.tenantId);
    if (!inv) throw new HttpError(404, "NOT_FOUND", "invoice not found");
    return reply.code(202).send(await commands.requestCancel(ctx, id, body.reason, inv.totalMinor));
  });

  // Checker decision on a pending approval (separation of duties enforced in consumer).
  app.patch("/v1/billing/invoices/:id/approvals/:approvalId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { approvalId } = approvalIdParam.parse(req.params);
    const body = approveBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.decideApproval(ctx, approvalId, body.approve, body.reason));
  });

  // Legacy: full settlement.
  app.patch("/v1/billing/invoices/:id/pay", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = idParam.parse(req.params);
    const inv = await queries.getInvoiceForPayment(id, ctx.tenantId);
    if (!inv) throw new HttpError(404, "NOT_FOUND", "invoice not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.payInvoice(ctx, id));
  });

  // Read model: bill detail (items + approvals + outstanding), tenant-scoped.
  app.get("/v1/billing/invoices/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = idParam.parse(req.params);
    const detail = await queries.getInvoiceDetail(id, ctx.tenantId);
    if (!detail) throw new HttpError(404, "NOT_FOUND", "invoice not found");
    return reply.send(detail);
  });

  // Read model: tenant outstanding aggregate.
  app.get("/v1/billing/tenants/:id/outstanding", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = tenantParam.parse(req.params);
    return reply.send(await queries.getOutstanding(id));
  });

  // Read model: list bills for a tenant.
  app.get("/v1/billing/tenants/:id/invoices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = tenantParam.parse(req.params);
    return reply.send(await queries.listInvoices(id));
  });

  // Caller-scoped list: returns invoices for the authenticated user's tenant.
  app.get("/v1/billing/invoices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BILLING_ROLES);
    return reply.send(await queries.listInvoices(ctx.tenantId));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof DomainError) {
      return reply.code(409).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
