import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { uuidParam, paginationQuery } from "../../shared/validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import {
  createInstalmentBody,
  createWriteOffBody,
  writeOffDecideBody,
  createRecoveryReferralBody,
} from "./validators.js";

const REVENUE_ROLES = ["revenue_admin", "revenue_officer", "finance_admin", "super_admin", "tenant_admin"];

export async function arrearsRoutes(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: error.message } });
    }
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    }
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal server error" } });
  });

  // ── POST /v1/revenue/instalments ────────────────────────────────────────────

  app.post("/v1/revenue/instalments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = createInstalmentBody.parse(req.body);
    const result = await commands.createInstalment(ctx, body as unknown as Record<string, unknown>);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/revenue/write-offs ─────────────────────────────────────────────

  app.post("/v1/revenue/write-offs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = createWriteOffBody.parse(req.body);
    const result = await commands.createWriteOff(ctx, body as unknown as Record<string, unknown>);
    return reply.code(202).send({ data: result });
  });

  // ── PATCH /v1/revenue/write-offs/:id/decide ─────────────────────────────────

  app.patch("/v1/revenue/write-offs/:id/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const body = writeOffDecideBody.parse(req.body);
    const result = await commands.decideWriteOff(ctx, id, body as unknown as Record<string, unknown>);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/revenue/recovery-referrals ─────────────────────────────────────

  app.post("/v1/revenue/recovery-referrals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = createRecoveryReferralBody.parse(req.body);
    const result = await commands.referRecovery(ctx, body as unknown as Record<string, unknown>);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/revenue/assessees/:id/instalments ───────────────────────────────

  app.get("/v1/revenue/assessees/:id/instalments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id: assesseeId } = uuidParam.parse(req.params);
    const q = paginationQuery.parse(req.query);
    const rows = await repo.listInstalmentPlans(ctx.tenantId, assesseeId, q);
    return reply.send({
      data: rows.slice(q.offset, q.offset + q.limit),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: rows.length },
    });
  });
}
