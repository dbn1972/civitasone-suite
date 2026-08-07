import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { paginationQuery } from "../../shared/validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import {
  createRateHeadBody,
  createRateSlabBody,
  createPenaltyRuleBody,
  createRebateRuleBody,
} from "./validators.js";

const REVENUE_ROLES = ["revenue_admin", "revenue_officer", "finance_admin", "super_admin", "tenant_admin"];

export async function rateEngineRoutes(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: error.message } });
    }
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    }
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal server error" } });
  });

  // ── POST routes (command publish → 202) ──────────────────────────────────

  app.post("/v1/revenue/rate-heads", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = createRateHeadBody.parse(req.body);
    const result = await commands.createRateHead(ctx, body);
    return reply.code(202).send({ data: result });
  });

  app.post("/v1/revenue/rate-slabs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = createRateSlabBody.parse(req.body);
    const result = await commands.createRateSlab(ctx, body);
    return reply.code(202).send({ data: result });
  });

  app.post("/v1/revenue/penalty-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = createPenaltyRuleBody.parse(req.body);
    const result = await commands.createPenaltyRule(ctx, body);
    return reply.code(202).send({ data: result });
  });

  app.post("/v1/revenue/rebate-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = createRebateRuleBody.parse(req.body);
    const result = await commands.createRebateRule(ctx, body);
    return reply.code(202).send({ data: result });
  });

  // ── GET routes (paginated reads from repo) ────────────────────────────────

  /** Aggregate config endpoint — returns heads, slabs, penalty, and rebate in one call. */
  app.get("/v1/revenue/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const heads = await repo.listRateHeads(ctx.tenantId) ?? [];
    return reply.send({
      data: {
        rateHeads: heads,
        totalHeads: heads.length,
      },
    });
  });

  app.get("/v1/revenue/rate-heads", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const q = paginationQuery.parse(req.query);
    const rows = await repo.listRateHeads(ctx.tenantId) ?? [];
    return reply.send({
      data: rows.slice(q.offset, q.offset + q.limit),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: rows.length },
    });
  });

  app.get("/v1/revenue/rate-slabs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const q = paginationQuery.parse(req.query);
    const { rateHeadId } = req.query as { rateHeadId?: string };
    if (!rateHeadId) {
      throw new HttpError(400, "VALIDATION_FAILED", "rateHeadId query parameter is required");
    }
    const rows = await repo.listRateSlabs(ctx.tenantId, rateHeadId) ?? [];
    return reply.send({
      data: rows.slice(q.offset, q.offset + q.limit),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: rows.length },
    });
  });

  app.get("/v1/revenue/penalty-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const q = paginationQuery.parse(req.query);
    const { rateHeadId } = req.query as { rateHeadId?: string };
    if (!rateHeadId) {
      throw new HttpError(400, "VALIDATION_FAILED", "rateHeadId query parameter is required");
    }
    const rows = await repo.listPenaltyRules(ctx.tenantId, rateHeadId) ?? [];
    return reply.send({
      data: rows.slice(q.offset, q.offset + q.limit),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: rows.length },
    });
  });

  app.get("/v1/revenue/rebate-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const q = paginationQuery.parse(req.query);
    const { rateHeadId } = req.query as { rateHeadId?: string };
    if (!rateHeadId) {
      throw new HttpError(400, "VALIDATION_FAILED", "rateHeadId query parameter is required");
    }
    const rows = await repo.listRebateRules(ctx.tenantId, rateHeadId) ?? [];
    return reply.send({
      data: rows.slice(q.offset, q.offset + q.limit),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: rows.length },
    });
  });
}
