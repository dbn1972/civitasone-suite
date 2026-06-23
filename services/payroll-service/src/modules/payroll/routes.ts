import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { PayrollRunDetailListSchema, PayrollRunFullDetailSchema, SalarySlipSummaryListSchema } from "@civitasone/schemas/web";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, requirePermissionKey, HttpError } from "../../shared/context.js";
import { createStructureBody, createRunBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const READER_ROLES  = [...PAYROLL_ROLES, "hr_admin", "finance_officer"];

export async function payrollRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/runs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, PayrollRunDetailListSchema, await queries.listRuns(ctx.tenantId, q.limit));
  });

  app.get("/v1/payroll/structures", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await queries.listStructures(ctx.tenantId, q.limit));
  });

  app.get("/v1/payroll/runs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const run = await queries.getRunDetail(id, ctx.tenantId);
    if (!run) throw new HttpError(404, "NOT_FOUND", "run not found");
    sendValidated(reply, PayrollRunFullDetailSchema, run);
  });

  app.get("/v1/payroll/salary-slips", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, SalarySlipSummaryListSchema, await queries.listSalarySlips(ctx.tenantId, q.limit));
  });

  app.post("/v1/payroll/structures", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = createStructureBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createStructure(ctx, body));
  });

  app.post("/v1/payroll/runs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = createRunBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createRun(ctx, body));
  });

  app.patch("/v1/payroll/runs/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    await requirePermissionKey(ctx, "payroll.run.approve");
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveRun(ctx, id));
  });

  app.patch("/v1/payroll/runs/:id/disburse", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.disburseRun(ctx, id));
  });

  app.get("/v1/payroll/slips/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const slip = await queries.getSlip(id, ctx.tenantId);
    if (!slip) throw new HttpError(404, "NOT_FOUND", "slip not found");
    return reply.send(slip);
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
