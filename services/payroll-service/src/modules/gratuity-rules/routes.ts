/**
 *  GET  /v1/payroll/statutory/gratuity/rules?asOf=YYYY-MM-DD  resolved rule + history + suggested parameters
 *  POST /v1/payroll/statutory/gratuity/rules                  new effective-dated tenant rule (payroll_admin / super_admin; audited)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { createGratuityRuleBody } from "./api.js";
import * as commands from "./commands.js";
import { loadGratuityRuleRows, resolveGratuityRule, serializeGratuityRule, SUGGESTED_GRATUITY_RULES } from "./rules.js";

const READ_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"];
const WRITE_ROLES = ["payroll_admin", "super_admin"];
const dateQ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function gratuityRuleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/statutory/gratuity/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = z.object({ asOf: dateQ.optional() }).parse(req.query);
    const asOf = q.asOf ?? new Date().toISOString().slice(0, 10);
    const rows = await scopedRead((tx) => loadGratuityRuleRows(tx, ctx.tenantId));
    return reply.send({
      asOf,
      resolved: serializeGratuityRule(resolveGratuityRule(rows, asOf)),
      history: rows.map((r) => ({
        id: r.id, effectiveFrom: r.effectiveFrom, ruleSet: r.ruleSet, minServiceYears: r.minServiceYears,
        ceilingMinor: r.ceilingMinor.toString(), changeReason: r.changeReason, createdAt: r.createdAt, createdBy: r.createdBy,
      })),
      // Pre-fills only; never applied implicitly.
      suggested: SUGGESTED_GRATUITY_RULES,
    });
  });

  app.post("/v1/payroll/statutory/gratuity/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createGratuityRuleBody.parse(req.body);
    if (Number.isNaN(Date.parse(body.effectiveFrom))) throw new HttpError(400, "VALIDATION_FAILED", "effectiveFrom is not a valid date");
    const existing = await scopedRead((tx) => loadGratuityRuleRows(tx, ctx.tenantId));
    if (existing.some((r) => r.effectiveFrom === body.effectiveFrom)) {
      throw new HttpError(409, "RULE_EXISTS_FOR_DATE", `a gratuity rule already takes effect on ${body.effectiveFrom}`);
    }
    return reply.code(202).send(await commands.createGratuityRule(ctx, body));
  });
}
