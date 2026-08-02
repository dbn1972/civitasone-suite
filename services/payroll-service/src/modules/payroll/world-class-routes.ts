import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { createArrearBody, computeBonusBody, createReimbursementBody } from "./validators.js";

const ROLES = ["payroll_admin","payroll_officer","super_admin","hr_admin"];

export async function worldClassPayrollRoutes(app: FastifyInstance): Promise<void> {
  // Arrears
  app.get("/v1/payroll/arrears", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const rows = await repo.listArrears(ctx.tenantId);
    return reply.send({ data: rows });
  });

  // CQRS lift (quality-payroll-95): was a synchronous db.execute() INSERT in
  // the request path; now publishes payroll.arrear.create and returns 202 —
  // the arrearCreate consumer (payroll/consumer.js) persists it asynchronously.
  app.post("/v1/payroll/arrears", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createArrearBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createArrear(ctx, body));
  });

  // Bonus
  app.get("/v1/payroll/bonus", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({ fy: z.string().optional() }).parse(req.query);
    const rows = await repo.listBonus(ctx.tenantId, q.fy ?? null);
    return reply.send({ data: rows });
  });

  // CQRS lift (quality-payroll-95): was a synchronous db.execute() INSERT in
  // the request path (with the bonus amount computed in the HTTP handler);
  // now publishes payroll.bonus.compute and returns 202 — the bonusCompute
  // consumer (payroll/consumer.js) computes bonusAmountMinor and persists it
  // asynchronously, as the single source of truth for the calculation.
  app.post("/v1/payroll/bonus/compute", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = computeBonusBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.computeBonus(ctx, body));
  });

  // Professional Tax
  app.get("/v1/payroll/statutory/pt", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const rows = await repo.listProfessionalTax(ctx.tenantId);
    return reply.send({ data: rows });
  });

  // LWF
  app.get("/v1/payroll/statutory/lwf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const rows = await repo.listLwf(ctx.tenantId);
    return reply.send({ data: rows });
  });

  // Reimbursements
  app.get("/v1/payroll/reimbursements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({
      employeeId: z.string().uuid().optional(),
      status: z.string().optional(),
    }).parse(req.query);
    const rows = await repo.listReimbursements(ctx.tenantId, q.employeeId ?? null, q.status ?? null);
    return reply.send({ data: rows });
  });

  // CQRS lift (quality-payroll-95): was a synchronous db.execute() INSERT in
  // the request path; now publishes payroll.reimbursement.create and returns
  // 202 — the reimbursementCreate consumer (payroll/consumer.js) persists it
  // asynchronously.
  app.post("/v1/payroll/reimbursements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...ROLES, "employee"]);
    const body = createReimbursementBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createReimbursement(ctx, body));
  });

  // Salary Revisions
  app.get("/v1/payroll/salary-revisions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({ employeeId: z.string().uuid().optional() }).parse(req.query);
    const rows = await repo.listSalaryRevisions(ctx.tenantId, q.employeeId ?? null);
    return reply.send({ data: rows });
  });

  // Payroll Register (department summary)
  app.get("/v1/payroll/register", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({
      period: z.string().optional(),
      runId: z.string().uuid().optional(),
    }).parse(req.query);
    const rows = await repo.listRegister(ctx.tenantId, q.period ?? null, q.runId ?? null);
    return reply.send({ data: rows });
  });

  // CTC Calculator
  app.get("/v1/payroll/ctc/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const rows = await repo.listCtcConfig(ctx.tenantId);
    return reply.send({ data: rows });
  });

  app.post("/v1/payroll/ctc/calculate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = z.object({ ctcMinor: z.number().int().positive() }).parse(req.body);
    const config = await repo.listCtcConfig(ctx.tenantId);
    const comps = (config as any[]).map((c: any) => {
      let amt = 0;
      if (c.calc_type === "pct_of_ctc") {
        amt = Math.round(body.ctcMinor * Number(c.value) / 100);
      } else if (c.calc_type === "pct_of_basic") {
        const basic = Math.round(body.ctcMinor * 40 / 100);
        amt = Math.round(basic * Number(c.value) / 100);
      } else {
        amt = Math.round(Number(c.value));
      }
      return { code: c.component_code, name: c.component_name, amountMinor: amt, isEmployerCost: c.is_employer_cost };
    });
    const gross = comps.filter((c: any) => !c.isEmployerCost).reduce((s: number, c: any) => s + c.amountMinor, 0);
    const employerCost = comps.filter((c: any) => c.isEmployerCost).reduce((s: number, c: any) => s + c.amountMinor, 0);
    return reply.send({ ctcMinor: body.ctcMinor, grossMinor: gross, employerCostMinor: employerCost, components: comps });
  });

  // Payroll Comparison (month-on-month)
  app.get("/v1/payroll/comparison", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({ period1: z.string(), period2: z.string() }).parse(req.query);
    const [s1, s2] = await Promise.all([
      repo.getRegisterSummary(ctx.tenantId, q.period1),
      repo.getRegisterSummary(ctx.tenantId, q.period2),
    ]);
    return reply.send({
      period1: { period: q.period1, ...s1 },
      period2: { period: q.period2, ...s2 },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
