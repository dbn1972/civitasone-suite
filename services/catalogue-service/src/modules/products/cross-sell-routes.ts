/**
 * PC-008 — cross-sell relationships. Mutations publish commands → 202.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as productRepo from "./repo.js";
import * as repo from "./governance-repo.js";
import { CROSS_SELL_RULE_TYPES } from "./governance-schema.js";
import * as commands from "./commands.js";

const READ_ROLES = ["catalogue_user", "catalogue_admin", "catalogue_approver", "field_agent", "super_admin"];
const WRITE_ROLES = ["catalogue_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const ruleIdParam = z.object({ ruleId: z.string().uuid() });
const listQuery = z.object({ enabledOnly: z.coerce.boolean().default(false) });
const createBody = z.object({
  targetProductId: z.string().uuid(),
  ruleType: z.enum(CROSS_SELL_RULE_TYPES).default("cross_sell"),
  priority: z.number().int().min(0).max(1000).default(0),
  enabled: z.boolean().default(true),
  note: z.string().max(500).optional(),
});

export async function crossSellRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/catalogue/products/:id/cross-sell", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const q = listQuery.parse(req.query);
    const product = await productRepo.findById(id, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");
    const rows = await repo.listCrossSell(id, ctx.tenantId, q.enabledOnly);
    return reply.send({ data: rows, meta: { page: 1, pageSize: rows.length, total: rows.length } });
  });

  app.post("/v1/catalogue/products/:id/cross-sell", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createBody.parse(req.body);
    if (body.targetProductId === id) {
      throw new HttpError(422, "SELF_CROSS_SELL", "A product cannot cross-sell itself");
    }
    const source = await productRepo.findById(id, ctx.tenantId);
    if (!source) throw new HttpError(404, "NOT_FOUND", "Source product not found");
    const target = await productRepo.findById(body.targetProductId, ctx.tenantId);
    if (!target) throw new HttpError(404, "NOT_FOUND", "Target product not found");
    const existing = await repo.listCrossSell(id, ctx.tenantId, false);
    if (existing.some((r) => r.targetProductId === body.targetProductId && r.ruleType === body.ruleType)) {
      throw new HttpError(422, "DUPLICATE_CROSS_SELL", `A '${body.ruleType}' rule for this product pair already exists`);
    }
    return reply.code(202).send(
      await commands.createCrossSellRule(ctx, id, {
        targetProductId: body.targetProductId,
        ruleType: body.ruleType,
        priority: body.priority,
        enabled: body.enabled,
        note: body.note ?? null,
      }),
    );
  });

  app.delete("/v1/catalogue/cross-sell/:ruleId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { ruleId } = ruleIdParam.parse(req.params);
    const existing = await repo.findCrossSellById(ruleId, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Cross-sell rule not found");
    return reply.code(202).send(
      await commands.deleteCrossSellRule(ctx, ruleId, {
        sourceProductId: existing.sourceProductId,
        targetProductId: existing.targetProductId,
        ruleType: existing.ruleType,
      }),
    );
  });
}
