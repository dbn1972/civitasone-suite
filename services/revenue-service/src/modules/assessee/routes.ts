import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { uuidParam, paginationQuery } from "../../shared/validators.js";
import { createAssesseeBody, updateAssesseeBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const REVENUE_ROLES = ["revenue_admin", "revenue_officer", "finance_admin", "super_admin", "tenant_admin"];

export async function assesseeRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/revenue/assessees — create assessee
  app.post("/v1/revenue/assessees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = createAssesseeBody.parse(req.body);
    const result = await commands.createAssessee(ctx, body);
    return reply.code(202).send({ data: result });
  });

  // PATCH /v1/revenue/assessees/:id — update assessee
  app.patch("/v1/revenue/assessees/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const body = updateAssesseeBody.parse(req.body);
    const result = await commands.updateAssessee(ctx, { assesseeId: id, ...body });
    return reply.code(202).send({ data: result });
  });

  // GET /v1/revenue/assessees/:id — find assessee by ID
  app.get("/v1/revenue/assessees/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const row = await repo.findAssessee(ctx.tenantId, id);
    if (!row) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "assessee not found" } });
    return reply.send({ data: row });
  });

  // GET /v1/revenue/assessees — list assessees
  app.get("/v1/revenue/assessees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const q = paginationQuery.parse(req.query);
    const result = await repo.listAssessees(ctx.tenantId, q);
    return reply.send(result);
  });
}
