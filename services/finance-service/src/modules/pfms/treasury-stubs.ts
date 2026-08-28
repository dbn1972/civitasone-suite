/**
 * PFMS Treasury Gateway Routes
 *
 * Thin HTTP layer: validates requests, delegates to ./pfms-client.ts for the
 * actual PFMS treasury operation, and maps PfmsTreasuryError onto HTTP
 * responses. This file used to contain an unlabeled stub (random UUIDs,
 * always-success, no indication anything was simulated) inline — it no
 * longer does. See pfms-client.ts for mode resolution (sandbox vs. live),
 * DSC signing, retry/timeout behavior, and audit logging.
 *
 * Endpoints:
 *  POST /v1/finance/pfms/payment-advice    — generate payment advice for treasury
 *  GET  /v1/finance/pfms/payment-status/:adviceId — check payment status
 *  POST /v1/finance/pfms/salary-bill       — submit salary bill to treasury
 *  GET  /v1/finance/treasury/balance       — fetch treasury balance
 *
 * Every response body includes `mode: "sandbox" | "live"` (see pfms-client.ts)
 * so nothing downstream can mistake a simulated result for a real government
 * transaction.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, financeErrorHandler } from "../../shared/context.js";
import {
  submitPaymentAdvice,
  getPaymentStatus,
  submitSalaryBill,
  getTreasuryBalance,
  PfmsTreasuryError,
} from "./pfms-client.js";

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
  app.post("/v1/finance/pfms/payment-advice", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = paymentAdviceBody.parse(req.body);

    const result = await submitPaymentAdvice(body);
    return reply.code(201).send({ data: result });
  });

  app.get("/v1/finance/pfms/payment-status/:adviceId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { adviceId } = z.object({ adviceId: z.string().uuid() }).parse(req.params);

    const result = await getPaymentStatus(adviceId);
    return reply.send({ data: result });
  });

  app.post("/v1/finance/pfms/salary-bill", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = salaryBillBody.parse(req.body);

    const result = await submitSalaryBill(body);
    return reply.code(201).send({ data: result });
  });

  app.get("/v1/finance/treasury/balance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const result = await getTreasuryBalance(ctx.tenantId);
    return reply.send({ data: result });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    // PfmsTreasuryError is specific to this module's upstream integration —
    // check it first, then delegate ZodError/HttpError/everything else to the
    // shared handler (which now preserves a real statusCode instead of
    // flattening it to 500, e.g. malformed JSON body / rate-limit 429).
    if (err instanceof PfmsTreasuryError) {
      // Explicit cast: setErrorHandler types its callback's error as a generic
      // `TError extends Error = FastifyError` (see fastify/types/instance.d.ts), and
      // narrowing that generic parameter via `instanceof` does not reliably widen member
      // access to PfmsTreasuryError-only fields (httpStatus) under this repo's tsconfig,
      // even though the instanceof check above has already verified it at runtime.
      const pfmsErr = err as PfmsTreasuryError;
      // DSC_CONFIG_MISSING is "we refuse to submit unsigned" (service misconfigured, not
      // the caller's fault) → 503. Everything else (network failure after retry, a live
      // non-2xx response, a signing failure) is an upstream/integration problem → 502.
      // Never leak the raw upstream response body here — see pfms-client.ts's PII note.
      const status = pfmsErr.code === "DSC_CONFIG_MISSING" ? 503 : 502;
      req.log.error(
        { adapter: "pfms-treasury", code: pfmsErr.code, httpStatus: pfmsErr.httpStatus, correlationId },
        "PFMS treasury error",
      );
      return reply.code(status).send({ code: pfmsErr.code, message: "PFMS treasury service error", correlationId });
    }
    return financeErrorHandler(err, req, reply);
  });
}
