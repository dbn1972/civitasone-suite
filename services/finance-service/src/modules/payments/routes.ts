import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import { paymentsListSchema, BillSummaryListSchema, BillDetailSchema, AdvanceSummaryListSchema, UCSummaryListSchema } from "@civitasone/schemas/web";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createBillBody, approveBillBody, initiateEftBody, gemInvoiceMatchBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const FINANCE_ROLES  = ["finance_officer", "finance_admin", "super_admin"];
const APPROVER_ROLES = ["accounts_officer", "finance_admin", "super_admin"];
const READER_ROLES   = [...FINANCE_ROLES, "audit_officer", "procurement_officer"];

export async function paymentsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/payments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, paymentsListSchema, await queries.listPayments(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/finance/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, BillSummaryListSchema, await queries.listBillSummaries(ctx.tenantId, q.limit));
  });

  app.get("/v1/finance/bills/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const detail = await queries.getBillDetail(id, ctx.tenantId);
    if (!detail) throw new HttpError(404, "NOT_FOUND", "bill not found");
    sendValidated(reply, BillDetailSchema, detail);
  });

  app.get("/v1/finance/advances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, AdvanceSummaryListSchema, await queries.listAdvances(ctx.tenantId, q.limit));
  });

  app.get("/v1/finance/utilization-certificates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, UCSummaryListSchema, await queries.listUCs(ctx.tenantId, q.limit));
  });

  app.post("/v1/finance/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createBillBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createBill(ctx, body));
  });

  app.patch("/v1/finance/bills/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = approveBillBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveBill(ctx, id, body));
  });

  app.post("/v1/finance/payments/eft", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = initiateEftBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.initiatePayment(ctx, body));
  });

  app.get("/v1/finance/payments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const payment = await queries.getPayment(id, ctx.tenantId);
    if (!payment) throw new HttpError(404, "NOT_FOUND", "payment not found");
    return reply.send(payment);
  });

  app.post("/v1/finance/gem/einvoice/match", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = gemInvoiceMatchBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.gemInvoiceMatch(ctx, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
