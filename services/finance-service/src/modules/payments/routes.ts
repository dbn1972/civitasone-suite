import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import { paymentsListSchema, BillSummaryListSchema, BillDetailSchema, AdvanceSummaryListSchema, UCSummaryListSchema } from "@civitasone/schemas/web";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createBillBody, approveBillBody, rejectBillBody, initiateEftBody, gemInvoiceMatchBody, createAdvanceBody, createUCBody, adjustAdvanceBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

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

  app.post("/v1/finance/advances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createAdvanceBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createAdvance(ctx, body));
  });

  app.post("/v1/finance/utilization-certificates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createUCBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createUC(ctx, body));
  });

  app.post("/v1/finance/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createBillBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createBill(ctx, body));
  });

  // Sample data ("try it"): add clearly-marked [SAMPLE] bills, or clear them.
  // Tenant-scoped; clearing removes ONLY this tenant's sample bills (R15).
  app.post("/v1/finance/bills/sample-data", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const added = await repo.seedSampleBills(ctx.tenantId, ctx.actorId);
    await cache.invalidateResource(ctx.tenantId, "bills");
    return reply.send({ added });
  });

  app.delete("/v1/finance/bills/sample-data", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const removed = await repo.clearSampleBills(ctx.tenantId);
    await cache.invalidateResource(ctx.tenantId, "bills");
    return reply.send({ removed });
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

  // H1 (payment) — submit a payment to eOffice for administrative approval. The
  // eFile is raised via the eOffice integration; the decision returns on
  // finance.payment.file_decided and moves the payment to released/cancelled.
  app.post("/v1/finance/payments/:id/submit-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitPaymentForApproval(ctx, id));
  });


  // PATCH /v1/finance/bills/:id/reject — reject a pending bill (finance_admin/super_admin)
  app.patch("/v1/finance/bills/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectBillBody.parse(req.body);
    await queue.publish(COMMANDS.billReject, {
      type: COMMANDS.billReject,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, reason: body.reason },
    });
    await cache.invalidate(cache.makeKey(ctx.tenantId, "bill", id));
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.post("/v1/finance/gem/einvoice/match", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = gemInvoiceMatchBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.gemInvoiceMatch(ctx, body));
  });

  app.patch("/v1/finance/advances/:id/adjust", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = adjustAdvanceBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.adjustAdvance(ctx, id, body));
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
