/**
 * PAY-PROFILES (payroll side) routes.
 *
 *  GET  /v1/payroll/allowance-rules?asOf=YYYY-MM     effective HRA floor + deputation rule, sources, history
 *  POST /v1/payroll/allowance-rules                  new effective-dated tenant row (payroll_admin / super_admin; audited)
 *  GET  /v1/payroll/reports/hra-floor-impact?month=  who the HRA floor raises, and by how much (pre-go-live review)
 *  GET  /v1/payroll/reports/foreign-service?month=   foreign-service deputationists (flag + report only)
 *  GET  /v1/payroll/runs/preflight?month=            blocking problems / warnings a salary run would hit
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead, type db } from "../../shared/db.js";
import { fetchPayrollInput, HrmsUnavailableError } from "../../shared/hrms-client.js";
import { resolveDaRateBps, resolveLatestRevisionsTx } from "../payroll/consumer.js";
import type { CityClass } from "../payroll/domain.js";
import {
  loadAllowanceRuleRows, resolveAllowanceRules, SUGGESTED_DEPUTATION_RULES,
} from "./allowance-rules.js";
import { foreignServiceReport, hraFloorImpact, payrollPreflight } from "./reports.js";
import * as commands from "./commands.js";
import { createAllowanceRulesBody, lockedThroughMonth, serializeRules } from "./rules-api.js";

const READ_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"];
const WRITE_ROLES = ["payroll_admin", "super_admin"];
const monthQ = z.string().regex(/^\d{4}-\d{2}$/, "must be YYYY-MM");
const minor = z.string().regex(/^\d{1,12}$/, "amount in paise as a digit string");

async function feedFor(tenantId: string, month: string) {
  try {
    return await fetchPayrollInput(tenantId, month);
  } catch (err) {
    if (err instanceof HrmsUnavailableError) throw new HttpError(503, "HRMS_UNAVAILABLE", err.message);
    throw err;
  }
}

export async function payProfileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/allowance-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = z.object({ asOf: monthQ.optional() }).parse(req.query);
    const asOf = q.asOf ?? new Date().toISOString().slice(0, 7);
    const rows = await scopedRead((tx) => loadAllowanceRuleRows(tx, ctx.tenantId));
    return reply.send({
      asOf,
      resolved: serializeRules(resolveAllowanceRules(rows, ctx.tenantId, asOf)),
      history: rows.map((r) => ({
        id: r.id, scope: r.tenantId ? "tenant" : "platform", effectiveFrom: r.effectiveFrom,
        hraFloorXMinor: r.hraFloorXMinor?.toString() ?? null,
        hraFloorYMinor: r.hraFloorYMinor?.toString() ?? null,
        hraFloorZMinor: r.hraFloorZMinor?.toString() ?? null,
        depSameStation: r.depSameBps != null && r.depSameCapMinor != null ? { rateBps: Number(r.depSameBps), capMinor: r.depSameCapMinor.toString() } : null,
        depOtherStation: r.depOtherBps != null && r.depOtherCapMinor != null ? { rateBps: Number(r.depOtherBps), capMinor: r.depOtherCapMinor.toString() } : null,
        changeReason: r.changeReason, createdAt: r.createdAt, createdBy: r.createdBy,
      })),
      // Pre-fill for the deputation-allowance form. NOT applied anywhere.
      suggestedDeputationRules: SUGGESTED_DEPUTATION_RULES,
    });
  });

  app.post("/v1/payroll/allowance-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createAllowanceRulesBody.parse(req.body);
    const { locked, existing } = await scopedRead(async (tx) => ({
      locked: await lockedThroughMonth(tx, ctx.tenantId),
      existing: (await loadAllowanceRuleRows(tx, ctx.tenantId)).some((r) => r.tenantId === ctx.tenantId && r.effectiveFrom === body.effectiveFrom),
    }));
    if (locked && body.effectiveFrom.slice(0, 7) <= locked) {
      throw new HttpError(409, "PERIOD_LOCKED", `payroll is locked through ${locked}; allowance rules can only change from a later month`);
    }
    if (existing) throw new HttpError(409, "RULES_EXIST_FOR_DATE", `a tenant allowance-rule row already takes effect on ${body.effectiveFrom}`);
    return reply.code(202).send(await commands.createAllowanceRules(ctx, body));
  });

  app.get("/v1/payroll/reports/hra-floor-impact", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = z.object({ month: monthQ, floorX: minor.optional(), floorY: minor.optional(), floorZ: minor.optional() }).parse(req.query);
    const input = await feedFor(ctx.tenantId, q.month);
    const { rules, daRateBps, revisions } = await scopedRead(async (tx) => {
      const rows = await loadAllowanceRuleRows(tx, ctx.tenantId);
      const daRate = await resolveDaRateBps(tx as unknown as typeof db, ctx.tenantId, q.month);
      const revs = await resolveLatestRevisionsTx(tx as unknown as typeof db, ctx.tenantId, input.employees.map((e) => e.id), q.month);
      return { rules: resolveAllowanceRules(rows, ctx.tenantId, q.month), daRateBps: daRate, revisions: revs };
    });
    const floors: Partial<Record<CityClass, bigint>> = {};
    if (q.floorX) floors.X = BigInt(q.floorX);
    if (q.floorY) floors.Y = BigInt(q.floorY);
    if (q.floorZ) floors.Z = BigInt(q.floorZ);
    const revisedBasic = new Map([...revisions].map(([id, r]) => [id, r.newBasicMinor]));
    const impact = hraFloorImpact(input.employees, q.month, daRateBps, rules, revisedBasic, floors);
    return reply.send({
      month: q.month,
      daRateBps: daRateBps.toString(),
      floorsMinor: {
        X: (floors.X ?? rules.hraFloorMinor.X).toString(),
        Y: (floors.Y ?? rules.hraFloorMinor.Y).toString(),
        Z: (floors.Z ?? rules.hraFloorMinor.Z).toString(),
      },
      ...impact,
    });
  });

  app.get("/v1/payroll/reports/foreign-service", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = z.object({ month: monthQ }).parse(req.query);
    const input = await feedFor(ctx.tenantId, q.month);
    const slipRows = await scopedRead(async (tx) => (await tx.execute(sql`
      SELECT DISTINCT ON (s.employee_id) s.employee_id, s.basic_minor, s.components
      FROM payroll.payroll_slips s
      JOIN payroll.payroll_runs r ON r.id = s.run_id AND r.tenant_id = s.tenant_id
      WHERE s.tenant_id = ${ctx.tenantId}::uuid AND r.month = ${q.month}
        AND r.run_type IN ('regular') AND r.status <> 'failed'
      ORDER BY s.employee_id, s.created_at DESC
    `)) as unknown as Array<{ employee_id: string; basic_minor: string | number; components: Array<{ code: string; amountMinor: number }> }>);
    const slips = new Map(slipRows.map((s) => [s.employee_id, { basicMinor: BigInt(s.basic_minor), components: s.components ?? [] }]));
    return reply.send({
      month: q.month,
      data: foreignServiceReport(input.employees, slips),
      note: "Flag and report only: pension and leave-salary contribution rates (FR 116/117) are not computed and nothing is posted to finance.",
    });
  });

  app.get("/v1/payroll/runs/preflight", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = z.object({ month: monthQ }).parse(req.query);
    const input = await feedFor(ctx.tenantId, q.month);
    const { rules, daRateBps, revisions } = await scopedRead(async (tx) => ({
      rules: resolveAllowanceRules(await loadAllowanceRuleRows(tx, ctx.tenantId), ctx.tenantId, q.month),
      daRateBps: await resolveDaRateBps(tx as unknown as typeof db, ctx.tenantId, q.month),
      revisions: await resolveLatestRevisionsTx(tx as unknown as typeof db, ctx.tenantId, input.employees.map((e) => e.id), q.month),
    }));
    const revisionEffective = new Map([...revisions].map(([id, r]) => [id, r.effectiveDate]));
    return reply.send({ month: q.month, ...payrollPreflight(input.employees, q.month, daRateBps, rules, revisionEffective) });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: err.status === 503 });
    }
    if (err instanceof Error && err.message.includes("DA_RATE_NOT_CONFIGURED")) {
      return reply.code(422).send({ code: "DA_RATE_NOT_CONFIGURED", message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
