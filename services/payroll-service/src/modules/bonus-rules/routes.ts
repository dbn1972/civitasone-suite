/**
 *  GET  /v1/payroll/bonus/rules?asOf=YYYY-MM-DD   resolved Payment-of-Bonus-Act parameters + history + VERIFY pre-fills
 *  POST /v1/payroll/bonus/rules                   new effective-dated tenant rule (payroll_admin / super_admin; audited)
 *  GET  /v1/payroll/bonus/basic?employeeId=       the employee's CURRENT basic from the HRMS payroll input (prefill)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { fetchPayrollInput, HrmsUnavailableError } from "../../shared/hrms-client.js";
import { createBonusRuleBody } from "./api.js";
import * as commands from "./commands.js";
import { loadBonusRuleRows, resolveBonusRule, serializeBonusRule, SUGGESTED_BONUS_RULE } from "./rules.js";

const READ_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin"];
const WRITE_ROLES = ["payroll_admin", "super_admin"];
const dateQ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function bonusRuleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/bonus/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = z.object({ asOf: dateQ.optional() }).parse(req.query);
    const asOf = q.asOf ?? new Date().toISOString().slice(0, 10);
    const rows = await scopedRead((tx) => loadBonusRuleRows(tx, ctx.tenantId));
    return reply.send({
      asOf,
      resolved: serializeBonusRule(resolveBonusRule(rows, asOf)),
      history: rows.map((r) => ({
        id: r.id, effectiveFrom: r.effectiveFrom,
        wageCeilingMinor: r.wageCeilingMinor?.toString() ?? null, eligibilityCeilingMinor: r.eligibilityCeilingMinor?.toString() ?? null,
        minBonusBps: r.minBonusBps, maxBonusBps: r.maxBonusBps, changeReason: r.changeReason, createdAt: r.createdAt, createdBy: r.createdBy,
      })),
      suggested: SUGGESTED_BONUS_RULE,
    });
  });

  app.post("/v1/payroll/bonus/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createBonusRuleBody.parse(req.body);
    if (Number.isNaN(Date.parse(body.effectiveFrom))) throw new HttpError(400, "VALIDATION_FAILED", "effectiveFrom is not a valid date");
    const existing = await scopedRead((tx) => loadBonusRuleRows(tx, ctx.tenantId));
    if (existing.some((r) => r.effectiveFrom === body.effectiveFrom)) {
      throw new HttpError(409, "RULE_EXISTS_FOR_DATE", `a bonus rule already takes effect on ${body.effectiveFrom}`);
    }
    return reply.code(202).send(await commands.createBonusRule(ctx, body));
  });

  app.get("/v1/payroll/bonus/basic", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { employeeId } = z.object({ employeeId: z.string().uuid() }).parse(req.query);
    const month = new Date().toISOString().slice(0, 7);
    let basicMinor: string | null = null;
    try {
      const input = await fetchPayrollInput(ctx.tenantId, month);
      const emp = input.employees.find((e) => e.id === employeeId);
      basicMinor = emp ? String(emp.basicMinor) : null;
    } catch (err) {
      if (err instanceof HrmsUnavailableError) {
        throw new HttpError(502, "HRMS_UNAVAILABLE", "cannot read the employee's basic: HRMS is unreachable");
      }
      throw err;
    }
    if (basicMinor == null) throw new HttpError(404, "NOT_FOUND", "employee not found in the HRMS payroll input");
    const rule = await scopedRead((tx) => loadBonusRuleRows(tx, ctx.tenantId).then((rows) => resolveBonusRule(rows, new Date().toISOString().slice(0, 10))));
    return reply.send({ employeeId, month, basicMinor, source: "hrms_payroll_input", rule: serializeBonusRule(rule) });
  });
}
