/**
 * Costing-rule maintenance (GAP-PAYROLL-COSTING-02).
 *
 *   PATCH /v1/payroll/costing/rules/:id   edit split %, deactivate, reactivate
 *
 * Create (POST) and list (GET) live in payroll/gap-routes.ts. A rule is never
 * deleted: a rule that has allocated cost in a past report must stay
 * explainable, so "remove" is deactivate (status = 'inactive'), which drops it
 * from the costing report and from the group's split total. The route
 * pre-checks synchronously (404 / 422), then publishes the command; the
 * consumer repeats the checks under a per-group advisory lock and writes +
 * audits in one transaction (CQRS: no DB writes here).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { requestCostingRuleUpdate } from "./commands.js";
import { exceedsCap, isValidSplitPct, otherActiveSplitHundredths } from "./split-cap.js";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];

export const updateRuleBody = z.object({
  splitPct: z.number().refine(isValidSplitPct, "splitPct must be above 0 and at most 100, with at most 2 decimals").optional(),
  status: z.enum(["active", "inactive"]).optional(),
}).strict().refine((b) => b.splitPct !== undefined || b.status !== undefined, "provide splitPct and/or status");

export async function costingRuleRoutes(app: FastifyInstance): Promise<void> {
  app.patch("/v1/payroll/costing/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updateRuleBody.parse(req.body ?? {});

    const rule = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, employee_group, cost_center_id, split_pct::text AS split_pct, status
        FROM payroll.costing_rules
       WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid LIMIT 1
    `))) as unknown as Array<{ id: string; employee_group: string; split_pct: string; status: string }>;
    if (!rule[0]) throw new HttpError(404, "NOT_FOUND", "costing rule not found");

    const nextStatus = body.status ?? rule[0].status;
    const nextSplit = body.splitPct ?? Number(rule[0].split_pct);
    if (nextStatus === "active") {
      const others = await scopedRead((tx) => otherActiveSplitHundredths(tx, ctx.tenantId, rule[0]!.employee_group, { ruleId: id }));
      if (exceedsCap(others, nextSplit)) {
        throw new HttpError(422, "COSTING_SPLIT_EXCEEDS_100",
          `this change would take employee group "${rule[0].employee_group}" above 100% (other active rules already total ${others / 100}%)`);
      }
    }
    return sendAccepted(reply, acceptedResponseSchema, await requestCostingRuleUpdate(ctx, { ruleId: id, ...body }));
  });
}
