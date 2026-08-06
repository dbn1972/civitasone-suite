import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createRuleBody, updateRuleBody, listQuery, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN_ROLES = ["crm_admin", "super_admin"];
const READ_ROLES = ["crm_user", "crm_admin", "super_admin"];

export async function segmentEligibilityRoutes(app: FastifyInstance): Promise<void> {
  // List rules (with optional segment/product filter)
  app.get("/v1/crm/segment-eligibility-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);
    const result = await queries.listRules(ctx.tenantId, q.limit, q.offset, q.segmentCode, q.productId);
    return reply.send({
      data: result.data,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: result.total },
    });
  });

  // Get single rule
  app.get("/v1/crm/segment-eligibility-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const rule = await queries.getRule(id, ctx.tenantId);
    if (!rule) throw new HttpError(404, "NOT_FOUND", "segment eligibility rule not found");
    return reply.send({ data: rule });
  });

  // Create rule
  app.post("/v1/crm/segment-eligibility-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createRuleBody.parse(req.body);
    const result = await commands.createRule(ctx, body);
    return reply.code(202).send({ data: result });
  });

  // Update rule
  app.patch("/v1/crm/segment-eligibility-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateRuleBody.parse(req.body);
    const result = await commands.updateRule(ctx, id, body);
    return reply.code(202).send({ data: result });
  });

  // Delete rule
  app.delete("/v1/crm/segment-eligibility-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const result = await commands.deleteRule(ctx, id);
    return reply.code(202).send({ data: result });
  });
}
