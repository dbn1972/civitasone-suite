import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";

const ROLES = ["payroll_admin","payroll_officer","super_admin","hr_admin"];

export async function worldClassPayrollRoutes(app: FastifyInstance): Promise<void> {
  // Arrears
  app.get("/v1/payroll/arrears", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const rows = await repo.listArrears(ctx.tenantId);
    return reply.send({ data: rows });
  });

  app.post("/v1/payroll/arrears", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = z.object({
      employeeId: z.string().uuid(),
      componentCode: z.string(),
      fromPeriod: z.string(),
      toPeriod: z.string(),
      oldAmountMinor: z.number().int(),
      newAmountMinor: z.number().int(),
      reason: z.string().optional(),
    }).parse(req.body);
    const row = await repo.insertArrear({
      tenantId: ctx.tenantId,
      employeeId: body.employeeId,
      componentCode: body.componentCode,
      fromPeriod: body.fromPeriod,
      toPeriod: body.toPeriod,
      oldAmountMinor: body.oldAmountMinor,
      newAmountMinor: body.newAmountMinor,
      reason: body.reason ?? null,
      actorId: ctx.actorId,
    });
    return reply.code(201).send({ data: row });
  });

  // Bonus
  app.get("/v1/payroll/bonus", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({ fy: z.string().optional() }).parse(req.query);
    const rows = await repo.listBonus(ctx.tenantId, q.fy ?? null);
    return reply.send({ data: rows });
  });

  app.post("/v1/payroll/bonus/compute", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = z.object({
      employeeId: z.string().uuid(),
      fy: z.string(),
      basicMinor: z.number().int(),
      bonusPct: z.number().default(8.33),
    }).parse(req.body);
    const bonusAmountMinor = Math.round(body.basicMinor * body.bonusPct / 100);
    const row = await repo.insertBonus({
      tenantId: ctx.tenantId,
      employeeId: body.employeeId,
      fy: body.fy,
      basicMinor: body.basicMinor,
      bonusPct: body.bonusPct,
      bonusAmountMinor,
    });
    return reply.code(201).send({ data: row });
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

  app.post("/v1/payroll/reimbursements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...ROLES, "employee"]);
    const body = z.object({
      employeeId: z.string().uuid(),
      category: z.enum(["medical","travel","lta","food","telephone","internet","fuel","other"]),
      amountMinor: z.number().int().positive(),
      billDate: z.string().optional(),
      billRef: z.string().optional(),
      period: z.string(),
    }).parse(req.body);
    const row = await repo.insertReimbursement({
      tenantId: ctx.tenantId,
      employeeId: body.employeeId,
      category: body.category,
      amountMinor: body.amountMinor,
      billDate: body.billDate ?? null,
      billRef: body.billRef ?? null,
      period: body.period,
      actorId: ctx.actorId,
    });
    return reply.code(201).send({ data: row });
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
}
