import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { evaluateProductEligibility, type EligibilityRule } from "./domain.js";
import * as commands from "./commands.js";

const CATALOGUE_ROLES = ["catalogue_user", "catalogue_admin", "super_admin"];
const ADMIN_ROLES = ["catalogue_admin", "super_admin"];

const createRuleBody = z.object({
  productId: z.string().uuid(),
  ruleType: z.string().min(1).max(64),
  criteria: z.record(z.unknown()),
});

const listRulesQuery = z.object({
  productId: z.string().uuid(),
});

const checkBody = z.object({
  customerAttributes: z.record(z.unknown()),
  productIds: z.array(z.string().uuid()).min(1),
});

const idParam = z.object({ id: z.string().uuid() });

export async function eligibilityRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/catalogue/eligibility/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createRuleBody.parse(req.body);
    return reply.code(202).send(
      await commands.createEligibilityRule(ctx, {
        productId: body.productId,
        ruleType: body.ruleType,
        criteria: body.criteria,
      }),
    );
  });

  app.get("/v1/catalogue/eligibility/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const q = listRulesQuery.parse(req.query);
    const rules = await repo.listByProduct(q.productId, ctx.tenantId);
    return reply.send({ data: rules, meta: { page: 1, pageSize: rules.length, total: rules.length } });
  });

  app.delete("/v1/catalogue/eligibility/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Eligibility rule not found");
    return reply.code(202).send(
      await commands.deleteEligibilityRule(ctx, id, {
        productId: existing.productId,
        ruleType: existing.ruleType,
      }),
    );
  });

  app.post("/v1/catalogue/eligibility/check", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const body = checkBody.parse(req.body);

    const allRules = await repo.listByProducts(body.productIds, ctx.tenantId);
    const rulesByProduct = new Map<string, EligibilityRule[]>();
    for (const pid of body.productIds) rulesByProduct.set(pid, []);
    for (const r of allRules) {
      const list = rulesByProduct.get(r.productId);
      if (list) list.push({ id: r.id, productId: r.productId, ruleType: r.ruleType, criteria: r.criteria });
    }

    const results = body.productIds.map((pid) => {
      const rules = rulesByProduct.get(pid) ?? [];
      if (rules.length === 0) {
        return { productId: pid, eligible: true, reasons: ["No rules defined — eligible by default"] };
      }
      return evaluateProductEligibility(rules, body.customerAttributes);
    });

    return reply.send({
      data: {
        eligibleProductIds: results.filter((r) => r.eligible).map((r) => r.productId),
        evaluatedRules: allRules.length,
        results,
      },
    });
  });
}
