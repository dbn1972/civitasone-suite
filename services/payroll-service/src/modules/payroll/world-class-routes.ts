import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sql } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead, db } from "../../shared/db.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { createArrearBody, computeBonusBody, createReimbursementBody } from "./validators.js";
import { randomUUID } from "node:crypto";

const ROLES = ["payroll_admin","payroll_officer","super_admin","hr_admin"];

export async function worldClassPayrollRoutes(app: FastifyInstance): Promise<void> {
  // Arrears
  app.get("/v1/payroll/arrears", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const rows = await repo.listArrears(ctx.tenantId);
    return reply.send({ data: rows });
  });

  // CQRS lift (quality-payroll-95): was a synchronous DB write in
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

  // CQRS lift (quality-payroll-95): was a synchronous DB write in
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

  // CQRS lift (quality-payroll-95): was a synchronous DB write in
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


  // ─── Gap: YTD (year-to-date) summary ─────────────────────────────────────
  app.get("/v1/payroll/ytd", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({
      employeeId: z.string().uuid(),
      fy:         z.string().regex(/^\d{4}-\d{2}$/).optional(),
    }).parse(req.query);

    const now = new Date();
    const fyStr = q.fy ?? (now.getMonth() + 1 >= 4
      ? `${now.getFullYear()}-${String(now.getFullYear() + 1).slice(-2)}`
      : `${now.getFullYear() - 1}-${String(now.getFullYear()).slice(-2)}`);
    const startYear = parseInt(fyStr.slice(0, 4), 10);
    const fromPeriod = `${startYear}-04`;
    const toPeriod   = `${startYear + 1}-03`;

    const slipRows = (await scopedRead((tx) => tx.execute(sql`
      SELECT s.gross_minor, s.total_deductions_minor, s.net_pay_minor,
             s.tds_minor, r.month
      FROM payroll.payroll_slips s
      JOIN payroll.payroll_runs r ON r.id = s.run_id
      WHERE s.tenant_id = ${ctx.tenantId}::uuid
        AND s.employee_id = ${q.employeeId}::uuid
        AND r.month >= ${fromPeriod}
        AND r.month <= ${toPeriod}
      ORDER BY r.month
    `))) as unknown as Array<{
      gross_minor: string; total_deductions_minor: string;
      net_pay_minor: string; tds_minor: string; month: string;
    }>;

    let ytdGross = 0, ytdNet = 0, ytdTds = 0, ytdDeductions = 0;
    for (const s of slipRows) {
      ytdGross       += Number(s.gross_minor);
      ytdDeductions  += Number(s.total_deductions_minor);
      ytdNet         += Number(s.net_pay_minor);
      ytdTds         += Number(s.tds_minor);
    }

    return reply.send({
      employeeId: q.employeeId,
      fy: fyStr,
      monthsProcessed: slipRows.length,
      ytdGrossMinor:      ytdGross,
      ytdDeductionsMinor: ytdDeductions,
      ytdNetMinor:        ytdNet,
      ytdTdsMinor:        ytdTds,
      breakdown: slipRows.map((s) => ({
        period: s.month,
        grossMinor:      Number(s.gross_minor),
        deductionsMinor: Number(s.total_deductions_minor),
        netMinor:        Number(s.net_pay_minor),
        tdsMinor:        Number(s.tds_minor),
      })),
    });
  });

  // ─── Gap: salary revision create ─────────────────────────────────────────
  app.post("/v1/payroll/salary-revisions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["payroll_admin", "payroll_officer", "super_admin"]);
    const body = z.object({
      employeeId:    z.string().uuid(),
      effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      oldBasicMinor: z.number().int().nonnegative(),
      newBasicMinor: z.number().int().positive(),
      oldGrossMinor: z.number().int().nonnegative(),
      newGrossMinor: z.number().int().positive(),
      revisionType:  z.enum(["annual_increment", "promotion", "correction", "fitment"]).default("annual_increment"),
      orderNo:       z.string().max(64).optional(),
    }).parse(req.body);

    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO payroll.payroll_salary_revisions
          (id, tenant_id, employee_id, effective_date, old_basic_minor, new_basic_minor,
           old_gross_minor, new_gross_minor, revision_type, order_no, approved_by, created_at)
        VALUES
          (${id}::uuid, ${ctx.tenantId}::uuid, ${body.employeeId}::uuid,
           ${body.effectiveDate}::date, ${body.oldBasicMinor}, ${body.newBasicMinor},
           ${body.oldGrossMinor}, ${body.newGrossMinor}, ${body.revisionType},
           ${body.orderNo ?? null}, ${ctx.actorId}::uuid, NOW())
      `);
    });
    return reply.code(201).send({ id, status: "created", correlationId: ctx.correlationId });
  });

  // ─── Gap: payroll settings ───────────────────────────────────────────────
  app.get("/v1/payroll/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT protected_net_floor_minor, updated_at
      FROM payroll.payroll_settings
      WHERE tenant_id = ${ctx.tenantId}::uuid
      LIMIT 1
    `))) as unknown as Array<{ protected_net_floor_minor: string; updated_at: string }>;
    const s = rows[0];
    return reply.send({
      protectedNetFloorMinor: s ? Number(s.protected_net_floor_minor) : 0,
      updatedAt: s?.updated_at ?? null,
    });
  });

  app.put("/v1/payroll/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["payroll_admin", "super_admin"]);
    const body = z.object({
      protectedNetFloorMinor: z.number().int().nonnegative(),
    }).parse(req.body);
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO payroll.payroll_settings (tenant_id, protected_net_floor_minor, created_at, updated_at)
        VALUES (${ctx.tenantId}::uuid, ${body.protectedNetFloorMinor}, NOW(), NOW())
        ON CONFLICT (tenant_id) DO UPDATE
          SET protected_net_floor_minor = EXCLUDED.protected_net_floor_minor,
              updated_at = NOW()
      `);
    });
    return reply.send({ protectedNetFloorMinor: body.protectedNetFloorMinor, updatedAt: new Date().toISOString() });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    // round2 fix: a framework-level error (e.g. Fastify's own body-parser
    // errors like FST_ERR_CTP_EMPTY_JSON_BODY on an empty body, or a raw
    // JSON.parse SyntaxError on a malformed one) is neither a ZodError nor an
    // HttpError, but Fastify still stamps a real client-error statusCode (and
    // usually an FST_ERR_* code) on it before it reaches here. Falling
    // through to the generic 500 below told the client retryable:true for
    // something that can never succeed on retry — a client that honors that
    // flag loops forever on a request that was malformed the moment it was
    // sent. Preserve the framework's own statusCode when it is a genuine 4xx,
    // the same way ZodError/HttpError are special-cased above.
    if (
      typeof err === "object" && err !== null &&
      "statusCode" in err && typeof (err as { statusCode: unknown }).statusCode === "number" &&
      (err as { statusCode: number }).statusCode >= 400 && (err as { statusCode: number }).statusCode < 500
    ) {
      const fw = err as { statusCode: number; code?: string; message?: string };
      return reply.code(fw.statusCode).send({
        code: fw.code ?? "BAD_REQUEST",
        message: fw.message ?? "invalid request",
        correlationId,
        retryable: false,
      });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
