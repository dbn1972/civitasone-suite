import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createLoanBody, idParam, loanQueryParams } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";

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

  // ─── Gap: loan detail ────────────────────────────────────────────────────
  app.get("/v1/payroll/loans/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const loan = await repo.findLoanById(id, ctx.tenantId);
    if (!loan) throw new HttpError(404, "NOT_FOUND", "loan not found");
    return reply.send(loan);
  });

  // ─── Gap: loan repayment schedule (amortisation) ────────────────────────
  app.get("/v1/payroll/loans/:id/schedule", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const loan = await repo.findLoanById(id, ctx.tenantId);
    if (!loan) throw new HttpError(404, "NOT_FOUND", "loan not found");

    const principal = Number(loan.principalMinor);
    const emiMinor  = Number(loan.emiMinor);
    const annualRate = Number(loan.interestRatePct);
    const tenure = loan.tenureMonths;
    const monthlyRate = annualRate / 100 / 12;

    const schedule: Array<{
      installmentNo: number;
      openingMinor: number;
      emiMinor: number;
      principalMinor: number;
      interestMinor: number;
      closingMinor: number;
    }> = [];

    let balance = principal;
    for (let i = 1; i <= tenure; i++) {
      const interest = monthlyRate > 0 ? Math.round(balance * monthlyRate) : 0;
      const principalPart = Math.min(emiMinor - interest, balance);
      const closing = Math.max(0, balance - principalPart);
      schedule.push({
        installmentNo: i,
        openingMinor: balance,
        emiMinor,
        principalMinor: principalPart,
        interestMinor: interest,
        closingMinor: closing,
      });
      balance = closing;
      if (balance === 0) break;
    }

    return reply.send({
      loanId: id,
      loanNo: loan.loanNo,
      tenureMonths: tenure,
      principalMinor: principal,
      emiMinor,
      interestRatePct: annualRate,
      schedule,
    });
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
