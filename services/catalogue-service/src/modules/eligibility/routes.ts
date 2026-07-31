import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { evaluateProductEligibility, type EligibilityRule } from "./domain.js";

const CATALOGUE_ROLES = ["catalogue_user", "catalogue_admin", "super_admin"];
const ADMIN_ROLES = ["catalogue_admin", "super_admin"];

const createRuleBody = z.object({
  productId: z.string().uuid(),
  ruleType: z.enum(["age_range", "residency", "segment", "min_income", "custom"]),
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
  // Create eligibility rule
  app.post("/v1/catalogue/eligibility/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createRuleBody.parse(req.body);
    const id = randomUUID();

    await db.transaction(async (tx) => {
      await repo.insertRule(tx, {
        id,
        tenantId: ctx.tenantId,
        productId: body.productId,
        ruleType: body.ruleType,
        criteria: body.criteria,
        status: "active",
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
        version: 1,
      });

      await enqueue(tx, {
        topic: EVENTS.eligibilityRuleCreated,
        eventType: EVENTS.eligibilityRuleCreated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { ruleId: id, productId: body.productId, ruleType: body.ruleType, criteria: body.criteria },
      });
    });

    return reply.code(201).send({ data: { id } });
  });

  // List rules for a product
  app.get("/v1/catalogue/eligibility/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const q = listRulesQuery.parse(req.query);
    const rules = await repo.listByProduct(q.productId, ctx.tenantId);
    return reply.send({ data: rules, meta: { page: 1, pageSize: rules.length, total: rules.length } });
  });

  // Delete rule (soft-delete by setting status = "deleted")
  app.delete("/v1/catalogue/eligibility/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Eligibility rule not found");

    await db.transaction(async (tx) => {
      const ok = await repo.deleteRule(tx, id, ctx.tenantId);
      if (!ok) throw new HttpError(404, "NOT_FOUND", "Eligibility rule not found");

      await enqueue(tx, {
        topic: EVENTS.eligibilityRuleDeleted,
        eventType: EVENTS.eligibilityRuleDeleted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { ruleId: id, productId: existing.productId, ruleType: existing.ruleType, status: "deleted" },
      });
    });

    return reply.code(200).send({ data: { id, status: "deleted" } });
  });

  // Check eligibility — evaluate customer attributes against rules for given products
  app.post("/v1/catalogue/eligibility/check", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const body = checkBody.parse(req.body);

    const allRules = await repo.listByProducts(body.productIds, ctx.tenantId);

    // Group rules by productId
    const rulesByProduct = new Map<string, EligibilityRule[]>();
    for (const pid of body.productIds) {
      rulesByProduct.set(pid, []);
    }
    for (const r of allRules) {
      const list = rulesByProduct.get(r.productId);
      if (list) {
        list.push({ id: r.id, productId: r.productId, ruleType: r.ruleType, criteria: r.criteria });
      }
    }

    // Evaluate each product
    const results = body.productIds.map((pid) => {
      const rules = rulesByProduct.get(pid) ?? [];
      if (rules.length === 0) {
        return { productId: pid, eligible: true, reasons: ["No rules defined — eligible by default"] };
      }
      return evaluateProductEligibility(rules, body.customerAttributes);
    });

    const eligibleProductIds = results.filter((r) => r.eligible).map((r) => r.productId);

    return reply.send({
      data: {
        eligibleProductIds,
        evaluatedRules: allRules.length,
        results,
      },
    });
  });
}
