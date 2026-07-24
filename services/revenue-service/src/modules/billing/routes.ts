import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { paginationQuery, uuidParam } from "../../shared/validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import { generateBillBody } from "./validators.js";

const REVENUE_ROLES = ["revenue_admin", "revenue_officer", "finance_admin", "super_admin", "tenant_admin"];

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: error.message } });
    }
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    }
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal server error" } });
  });

  // ── POST /v1/revenue/bills/generate → publish command → 202 ────────────────

  app.post("/v1/revenue/bills/generate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = generateBillBody.parse(req.body);
    const result = await commands.generateBill(ctx, body);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/revenue/assessees/:id/bills → paginated list ───────────────────

  app.get("/v1/revenue/assessees/:id/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const q = paginationQuery.parse(req.query);
    const { data, total } = await repo.listBills(ctx.tenantId, id, q);
    return reply.send({
      data,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });
}
