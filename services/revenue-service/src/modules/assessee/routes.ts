import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { uuidParam, paginationQuery } from "../../shared/validators.js";
import { z } from "zod";
import { createAssesseeBody, updateAssesseeBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const REVENUE_ROLES = ["revenue_admin", "revenue_officer", "finance_admin", "super_admin", "tenant_admin"];

// GAP-REVENUE-ASSESSEES-04: optional ?q= server-side search (owner name / identifier).
const listQuery = paginationQuery.extend({ q: z.string().trim().min(1).max(100).optional() });

export async function assesseeRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/revenue/assessees — create assessee
  app.post("/v1/revenue/assessees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = createAssesseeBody.parse(req.body);
    // GAP-REVENUE-ASSESSEES-03: reject a duplicate (tenant, identifierNo)
    // synchronously with 409 -- the async create consumer would otherwise hit the
    // unique index only after the API returned 202 (silent background failure).
    const existing = await repo.findAssesseeByIdentifier(ctx.tenantId, body.identifierNo);
    if (existing) {
      throw new HttpError(409, "DUPLICATE_IDENTIFIER", "an assessee with this identifier already exists");
    }
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
    const { q: search, ...q } = listQuery.parse(req.query);
    const result = await repo.listAssessees(ctx.tenantId, q, search);
    return reply.send(result);
  });
}
