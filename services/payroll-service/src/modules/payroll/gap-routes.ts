/**
 * World-class gap features — Routes for simulation, corrections, off-cycle,
 * pay groups, flex benefits, costing, and tax optimization.
 *
 * CQRS lift T1-03: the eight mutating routes previously performed synchronous
 * DB writes in the request path. They now publish a command
 * (payroll/commands.ts) and return 202; the write happens in the idempotent
 * consumer (payroll/consumer.ts), tenant-scoped via runWithTenant in worker.ts.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sql } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import * as commands from "./commands.js";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const READER_ROLES = [...PAYROLL_ROLES, "hr_admin", "finance_officer"];
const ALL_ROLES = [...READER_ROLES, "employee"];

export async function gapRoutes(app: FastifyInstance): Promise<void> {
  // ─── Gap 1: Payroll Simulation ──────────────────────────────────────────────
  app.post("/v1/payroll/runs/:id/simulate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    // Verify run exists
    const runs = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, month, status FROM payroll.payroll_runs
      WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid LIMIT 1
    `))) as unknown as Array<{ id: string; month: string; status: string }>;
    if (!runs[0]) throw new HttpError(404, "NOT_FOUND", "payroll run not found");
    const run = runs[0];

    // Pull existing slips for this run as simulated data
    const slips = (await scopedRead((tx) => tx.execute(sql`
      SELECT employee_id, employee_no, gross_minor, total_deductions_minor, net_pay_minor, tds_minor
      FROM payroll.payroll_slips
      WHERE run_id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid
    `))) as unknown as Array<{
      employee_id: string; employee_no: string; gross_minor: string;
      total_deductions_minor: string; net_pay_minor: string; tds_minor: string;
    }>;

    // Pull previous month slips for variance comparison
    const [yr, mo] = run.month.split("-").map(Number) as [number, number];
    const prevMonth = mo === 1 ? `${yr - 1}-12` : `${yr}-${String(mo - 1).padStart(2, "0")}`;
    const prevSlips = (await scopedRead((tx) => tx.execute(sql`
      SELECT s.employee_id, s.net_pay_minor
      FROM payroll.payroll_slips s
      JOIN payroll.payroll_runs r ON r.id = s.run_id
      WHERE r.month = ${prevMonth} AND s.tenant_id = ${ctx.tenantId}::uuid
    `))) as unknown as Array<{ employee_id: string; net_pay_minor: string }>;
    const prevMap = new Map(prevSlips.map((s) => [s.employee_id, BigInt(s.net_pay_minor)]));

    const threshold = 20; // % variance flag threshold
    const results = slips.map((s) => {
      const netMinor = BigInt(s.net_pay_minor);
      const prev = prevMap.get(s.employee_id) ?? 0n;
      const variance = prev > 0n ? Number((netMinor - prev) * 100n / prev) : 0;
      return {
        employeeId: s.employee_id, employeeNo: s.employee_no,
        grossMinor: Number(s.gross_minor), deductionsMinor: Number(s.total_deductions_minor),
        netMinor: Number(s.net_pay_minor), tdsMinor: Number(s.tds_minor),
        previousNetMinor: Number(prev), variancePct: Math.round(variance * 100) / 100,
        flagged: Math.abs(variance) > threshold,
      };
    });

    const totalGross = results.reduce((s, r) => s + r.grossMinor, 0);
    const totalNet = results.reduce((s, r) => s + r.netMinor, 0);
    const flaggedCount = results.filter((r) => r.flagged).length;

    return reply.send({
      runId: id, month: run.month, mode: "simulate",
      employeeCount: results.length, flaggedCount,
      totalGrossMinor: totalGross, totalNetMinor: totalNet,
      anomalyThresholdPct: threshold,
      employees: results,
    });
  });

  // ─── Gap 3: Salary Corrections ─────────────────────────────────────────────
  app.post("/v1/payroll/corrections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = z.object({
      employeeId: z.string().uuid(),
      component: z.string().min(1).max(32),
      effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      newValueMinor: z.number().int(),
      oldValueMinor: z.number().int(),
      reason: z.string().max(512).optional(),
    }).parse(req.body);

    // Affected-periods count depends on the current wall-clock month, so we
    // compute it here (pure function) and pass it in the command payload —
    // keeps the consumer deterministic replay-safe.
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const effMonth = body.effectiveFrom.slice(0, 7);
    let periods = 0;
    let [y, m] = effMonth.split("-").map(Number) as [number, number];
    const [cy, cm] = currentMonth.split("-").map(Number) as [number, number];
    while (y < cy || (y === cy && m <= cm)) { periods++; m++; if (m > 12) { m = 1; y++; } }
    const diffPerPeriod = BigInt(body.newValueMinor - body.oldValueMinor);
    const totalArrears = diffPerPeriod * BigInt(periods);

    return sendAccepted(reply, acceptedResponseSchema, await commands.createCorrection(ctx, {
      ...body,
      affectedPeriods: periods,
      arrearsMinor: totalArrears.toString(),
    }));
  });

  app.get("/v1/payroll/corrections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({ employeeId: z.string().uuid().optional() }).parse(req.query);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, employee_id, component, effective_from::text AS effective_from,
        old_value_minor, new_value_minor, arrears_minor, affected_periods, reason, status, created_at
      FROM payroll.salary_corrections
      WHERE tenant_id = ${ctx.tenantId}::uuid
        ${q.employeeId ? sql`AND employee_id = ${q.employeeId}::uuid` : sql``}
      ORDER BY created_at DESC LIMIT 100
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows });
  });

  // ─── Gap 2: Pay Groups ────────────────────────────────────────────────────
  app.post("/v1/payroll/pay-groups", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = z.object({
      name: z.string().min(1).max(128),
      frequency: z.enum(["monthly", "bi_weekly", "weekly"]),
      payDayOfMonth: z.number().int().min(1).max(31).default(28),
      timezone: z.string().max(64).default("Asia/Kolkata"),
    }).parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPayGroup(ctx, body));
  });

  app.get("/v1/payroll/pay-groups", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, name, frequency, pay_day_of_month, timezone, status, created_at
      FROM payroll.pay_groups WHERE tenant_id = ${ctx.tenantId}::uuid AND status = 'active'
      ORDER BY name LIMIT 100
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows });
  });

  app.get("/v1/payroll/calendar", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query);
    const startYear = parseInt(q.fy.slice(0, 4), 10);
    const groups = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, name, frequency, pay_day_of_month FROM payroll.pay_groups
      WHERE tenant_id = ${ctx.tenantId}::uuid AND status = 'active'
    `))) as unknown as Array<{ id: string; name: string; frequency: string; pay_day_of_month: number }>;

    // Generate pay calendar: Apr startYear to Mar startYear+1
    const calendar: Array<{ group: string; month: string; payDate: string }> = [];
    for (const g of groups) {
      for (let m = 4; m <= 12; m++) {
        const day = Math.min(g.pay_day_of_month, new Date(startYear, m, 0).getDate());
        calendar.push({ group: g.name, month: `${startYear}-${String(m).padStart(2, "0")}`, payDate: `${startYear}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}` });
      }
      for (let m = 1; m <= 3; m++) {
        const day = Math.min(g.pay_day_of_month, new Date(startYear + 1, m, 0).getDate());
        calendar.push({ group: g.name, month: `${startYear + 1}-${String(m).padStart(2, "0")}`, payDate: `${startYear + 1}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}` });
      }
    }
    return reply.send({ fy: q.fy, groups: groups.length, calendar });
  });

  // ─── Gap 5: Flex Benefits ─────────────────────────────────────────────────
  app.post("/v1/payroll/flex-benefits/plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = z.object({
      name: z.string().min(1).max(128),
      fy: z.string().regex(/^\d{4}-\d{2}$/),
      totalBudgetMinor: z.number().int().positive(),
      components: z.array(z.object({
        name: z.string(), maxMinor: z.number().int().positive(), taxExempt: z.boolean().default(false),
      })).min(1).max(20),
    }).parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createFlexPlan(ctx, body));
  });

  app.post("/v1/payroll/flex-benefits/elections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = z.object({
      planId: z.string().uuid(),
      fy: z.string().regex(/^\d{4}-\d{2}$/),
      elections: z.array(z.object({ component: z.string(), electedMinor: z.number().int().min(0) })).min(1),
    }).parse(req.body);
    const totalElectedMinor = body.elections.reduce((s, e) => s + e.electedMinor, 0);
    return sendAccepted(reply, acceptedResponseSchema, await commands.upsertFlexElection(ctx, {
      ...body,
      totalElectedMinor,
    }));
  });

  app.get("/v1/payroll/flex-benefits/my-elections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT e.id, e.plan_id, e.fy, e.elections, e.total_elected_minor, e.status, p.name AS plan_name
      FROM payroll.flex_benefit_elections e
      JOIN payroll.flex_benefit_plans p ON p.id = e.plan_id
      WHERE e.tenant_id = ${ctx.tenantId}::uuid AND e.employee_id = ${ctx.actorId}::uuid
      ORDER BY e.fy DESC LIMIT 10
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows });
  });

  // ─── Gap 6: Costing Rules ────────────────────────────────────────────────
  app.post("/v1/payroll/costing/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = z.object({
      employeeGroup: z.string().min(1).max(64),
      costCenterId: z.string().uuid(),
      splitPct: z.number().min(0).max(100).default(100),
    }).parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.upsertCostingRule(ctx, body));
  });

  // FE gap (quality-payroll-95): the costing page previously had no way to
  // list rules — only create (POST) existed — so it showed a static
  // "not yet available" EmptyState. This closes that gap.
  app.get("/v1/payroll/costing/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, employee_group, cost_center_id, split_pct, status, created_at
      FROM payroll.costing_rules
      WHERE tenant_id = ${ctx.tenantId}::uuid
      ORDER BY employee_group, cost_center_id
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.get("/v1/payroll/costing/report", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT cr.employee_group, cr.cost_center_id, cr.split_pct,
        COALESCE(SUM(s.gross_minor * cr.split_pct / 100), 0)::bigint AS allocated_minor
      FROM payroll.costing_rules cr
      LEFT JOIN payroll.payroll_slips s ON s.tenant_id = cr.tenant_id
      LEFT JOIN payroll.payroll_runs r ON r.id = s.run_id AND r.month = ${q.period}
      WHERE cr.tenant_id = ${ctx.tenantId}::uuid AND cr.status = 'active'
      GROUP BY cr.employee_group, cr.cost_center_id, cr.split_pct
      ORDER BY cr.employee_group
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ period: q.period, data: rows });
  });

  // ─── Gap 7: Tax Optimization Advisor ──────────────────────────────────────
  app.get("/v1/payroll/tax/optimization", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = z.object({ employeeId: z.string().uuid() }).parse(req.query);

    // Fetch current declarations
    const now = new Date();
    const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fy = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;

    const decRows = (await scopedRead((tx) => tx.execute(sql`
      SELECT section_80c, section_80d, other_deductions, rent_paid_minor, regime
      FROM payroll.payroll_tax_declarations
      WHERE tenant_id = ${ctx.tenantId}::uuid AND employee_id = ${q.employeeId}::uuid AND fy = ${fy}
      ORDER BY created_at DESC LIMIT 1
    `))) as unknown as Array<{ section_80c: string; section_80d: string; other_deductions: string; rent_paid_minor: string; regime: string }>;
    const dec = decRows[0];

    const cap80c = 15000000n; // ₹1.5L in paise
    const cap80d = 5000000n;  // ₹50K in paise
    const used80c = dec ? BigInt(dec.section_80c) : 0n;
    const used80d = dec ? BigInt(dec.section_80d) : 0n;
    const remaining80c = cap80c - used80c > 0n ? cap80c - used80c : 0n;
    const remaining80d = cap80d - used80d > 0n ? cap80d - used80d : 0n;

    const suggestions: Array<{ section: string; headroom: number; suggestion: string }> = [];
    if (remaining80c > 0n) {
      suggestions.push({ section: "80C", headroom: Number(remaining80c), suggestion: "Invest in PPF/ELSS/NSC/LIC to utilize remaining 80C headroom" });
    }
    if (remaining80d > 0n) {
      suggestions.push({ section: "80D", headroom: Number(remaining80d), suggestion: "Health insurance premium (self/family/parents) can reduce taxable income" });
    }
    suggestions.push({ section: "80CCD(1B)", headroom: 5000000, suggestion: "Additional NPS contribution of up to ₹50,000 deductible beyond 80C" });

    return reply.send({
      employeeId: q.employeeId, fy, regime: dec?.regime ?? "new",
      used80cMinor: Number(used80c), used80dMinor: Number(used80d),
      remaining80cMinor: Number(remaining80c), remaining80dMinor: Number(remaining80d),
      suggestions,
    });
  });

  app.get("/v1/payroll/tax/regime-comparison", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = z.object({ employeeId: z.string().uuid() }).parse(req.query);
    // Simplified comparison — in production this calls the full tax engine
    return reply.send({
      employeeId: q.employeeId,
      oldRegime: { estimatedTaxMinor: 0, note: "Requires full annual income computation" },
      newRegime: { estimatedTaxMinor: 0, note: "Requires full annual income computation" },
      recommendation: "Use GET /v1/payroll/tax/computation with regime=old and regime=new for exact comparison",
    });
  });

  // ─── Gap 8: Off-Cycle Payments ────────────────────────────────────────────
  app.post("/v1/payroll/off-cycle", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = z.object({
      runType: z.enum(["bonus", "incentive", "adhoc"]),
      period: z.string().regex(/^\d{4}-\d{2}$/),
      description: z.string().max(256).optional(),
      items: z.array(z.object({
        employeeId: z.string().uuid(),
        amountMinor: z.number().int().positive(),
      })).min(1).max(1000),
    }).parse(req.body);
    const totalAmountMinor = body.items.reduce((s, i) => s + BigInt(i.amountMinor), 0n).toString();
    return sendAccepted(reply, acceptedResponseSchema, await commands.createOffCycle(ctx, {
      ...body,
      totalAmountMinor,
    }));
  });

  app.get("/v1/payroll/off-cycle", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, run_type, period, description, total_amount_minor, total_tax_minor, total_net_minor, status, created_at
      FROM payroll.off_cycle_runs WHERE tenant_id = ${ctx.tenantId}::uuid
      ORDER BY created_at DESC LIMIT 50
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows });
  });

  app.post("/v1/payroll/off-cycle/:id/process", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    // 404 pre-check: keep the existence guard in the route (read-only). The
    // actual 30% flat-tax computation now runs in the consumer — single
    // source of truth alongside the persisted update.
    const items = (await scopedRead((tx) => tx.execute(sql`
      SELECT id FROM payroll.off_cycle_items
      WHERE off_cycle_run_id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid
      LIMIT 1
    `))) as unknown as Array<{ id: string }>;
    if (items.length === 0) throw new HttpError(404, "NOT_FOUND", "off-cycle run not found or has no items");

    return sendAccepted(reply, acceptedResponseSchema, await commands.processOffCycle(ctx, id));
  });

  // ─── Gap 4: Multi-State PT/LWF (CRUD for state rules) ────────────────────
  app.post("/v1/payroll/statutory/state-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = z.object({
      stateCode: z.string().min(2).max(4),
      ptSlabs: z.array(z.object({ fromMinor: z.number().int(), toMinor: z.number().int(), taxMinor: z.number().int() })).optional(),
      lwfEmployee: z.number().int().optional(),
      lwfEmployer: z.number().int().optional(),
    }).parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.upsertStateRules(ctx, body));
  });

  app.get("/v1/payroll/statutory/state-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const pt = (await scopedRead((tx) => tx.execute(sql`
      SELECT state_code, slab_from_minor, slab_to_minor, pt_amount_minor
      FROM payroll.payroll_professional_tax WHERE tenant_id = ${ctx.tenantId}::uuid AND is_active = true
      ORDER BY state_code, slab_from_minor
    `))) as unknown as Array<Record<string, unknown>>;
    const lwf = (await scopedRead((tx) => tx.execute(sql`
      SELECT state_code, employee_contrib_minor, employer_contrib_minor, frequency
      FROM payroll.payroll_lwf WHERE tenant_id = ${ctx.tenantId}::uuid
      ORDER BY state_code
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ ptSlabs: pt, lwfConfig: lwf });
  });

  // Error handler
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
