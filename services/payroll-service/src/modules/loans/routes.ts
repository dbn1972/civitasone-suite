import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createLoanBody, idParam, loanQueryParams } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const READER_ROLES  = [...PAYROLL_ROLES, "hr_admin", "employee"];

export async function loansRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/payroll/loans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = createLoanBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createLoan(ctx, body));
  });

  app.patch("/v1/payroll/loans/:id/disburse", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.disburseLoan(ctx, id));
  });

  app.get("/v1/payroll/loans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { empId } = loanQueryParams.parse(req.query);
    if (!empId) throw new HttpError(400, "VALIDATION_FAILED", "empId is required");
    return reply.send(await queries.getLoansByEmployee(ctx.tenantId, empId));
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
