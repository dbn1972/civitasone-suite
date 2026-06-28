/**
 * PFMS / Treasury Integration Stubs
 *
 * INTEGRATION STUB — connect to real PFMS API when available
 *
 * Endpoints:
 *  POST /v1/finance/pfms/payment-advice    — generate payment advice for treasury
 *  GET  /v1/finance/pfms/payment-status/:adviceId — check payment status
 *  POST /v1/finance/pfms/salary-bill       — submit salary bill to treasury
 *  GET  /v1/finance/treasury/balance       — fetch treasury balance (stub: returns mock)
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin", "payroll_admin"];

const paymentAdviceBody = z.object({
  billId: z.string().uuid(),
  payeeName: z.string().min(1).max(256),
  payeeAccountNo: z.string().min(1).max(32),
  payeeIfsc: z.string().min(11).max(11),
  amountMinor: z.coerce.number().int().min(1).describe("Amount in paise"),
  purposeCode: z.string().min(1).max(32),
  ddoCode: z.string().max(32).optional(),
  schemeCode: z.string().max(32).optional(),
  remarks: z.string().max(2000).optional(),
});

const salaryBillBody = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).describe("YYYY-MM format"),
  departmentId: z.string().uuid(),
  totalAmountMinor: z.coerce.number().int().min(1),
  employeeCount: z.coerce.number().int().min(1),
  ddoCode: z.string().max(32),
  schemeCode: z.string().max(32).optional(),
  remarks: z.string().max(2000).optional(),
});

export async function pfmsTreasuryStubRoutes(app: FastifyInstance): Promise<void> {
  // INTEGRATION STUB — connect to real PFMS API when available
  app.post("/v1/finance/pfms/payment-advice", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = paymentAdviceBody.parse(req.body);

    // INTEGRATION STUB — connect to real PFMS API when available
    // In production this will call the PFMS payment advice API
    const adviceId = randomUUID();
    const pfmsRef = `PFMS-ADV-${Date.now()}-${adviceId.slice(0, 8).toUpperCase()}`;

    return reply.code(201).send({
      data: {
        adviceId,
        pfmsRef,
        billId: body.billId,
        amountMinor: body.amountMinor,
        status: "submitted",
        submittedAt: new Date().toISOString(),
        message: "STUB: Payment advice generated successfully. Connect to real PFMS when available.",
      },
    });
  });

  // INTEGRATION STUB — connect to real PFMS API when available
  app.get("/v1/finance/pfms/payment-status/:adviceId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { adviceId } = z.object({ adviceId: z.string().uuid() }).parse(req.params);

    // INTEGRATION STUB — connect to real PFMS API when available
    // In production this will query PFMS for payment status
    return reply.send({
      data: {
        adviceId,
        status: "processed",
        pfmsTransactionId: `PFMS-TXN-${adviceId.slice(0, 12).toUpperCase()}`,
        processedAt: new Date().toISOString(),
        utrNumber: `UTR${Date.now()}`,
        message: "STUB: Payment processed. Connect to real PFMS for live status.",
      },
    });
  });

  // INTEGRATION STUB — connect to real PFMS API when available
  app.post("/v1/finance/pfms/salary-bill", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = salaryBillBody.parse(req.body);

    // INTEGRATION STUB — connect to real PFMS API when available
    // In production this will submit salary bill to treasury via PFMS
    const billRef = randomUUID();
    const pfmsBillNo = `SAL-${body.month}-${body.ddoCode}-${billRef.slice(0, 6).toUpperCase()}`;

    return reply.code(201).send({
      data: {
        billRef,
        pfmsBillNo,
        month: body.month,
        departmentId: body.departmentId,
        totalAmountMinor: body.totalAmountMinor,
        employeeCount: body.employeeCount,
        status: "submitted_to_treasury",
        submittedAt: new Date().toISOString(),
        message: "STUB: Salary bill submitted to treasury. Connect to real PFMS when available.",
      },
    });
  });

  // INTEGRATION STUB — connect to real PFMS API when available
  app.get("/v1/finance/treasury/balance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    // INTEGRATION STUB — connect to real PFMS API when available
    // In production this will fetch live treasury balance from PFMS/bank
    return reply.send({
      data: {
        tenantId: ctx.tenantId,
        balanceMinor: "500000000000", // 500 Cr paise as string (stub)
        currency: "INR",
        asOf: new Date().toISOString(),
        accounts: [
          { accountType: "treasury", balanceMinor: "400000000000", bankName: "RBI" },
          { accountType: "assignment", balanceMinor: "100000000000", bankName: "SBI" },
        ],
        message: "STUB: Mock treasury balance. Connect to real PFMS/bank API when available.",
      },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
