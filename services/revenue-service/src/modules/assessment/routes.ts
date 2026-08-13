/**
 * Assessment module — Fastify route plugin.
 *
 * _Requirements: SVC-131, Requirement 6_
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { uuidParam, paginationQuery } from "../../shared/validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import {
  createAssessmentBody,
  reviseAssessmentBody,
  remitBody,
  remitDecideBody,
} from "./validators.js";

const REVENUE_ROLES = ["revenue_admin", "revenue_officer", "revenue_collector", "finance_admin", "super_admin", "tenant_admin"];

export async function assessmentRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/revenue/assessments → 202 ──────────────────────────────────
  app.post("/v1/revenue/assessments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = createAssessmentBody.parse(req.body);
    const result = await commands.createAssessment(ctx, body as unknown as Record<string, unknown>);
    return reply.code(202).send({ data: result });
  });

  // ── PATCH /v1/revenue/assessments/:id/revise → 202 ──────────────────────
  app.patch("/v1/revenue/assessments/:id/revise", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const body = reviseAssessmentBody.parse(req.body);
    const result = await commands.reviseAssessment(ctx, id, body as unknown as Record<string, unknown>);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/revenue/assessments/:id/remit → 202 ────────────────────────
  app.post("/v1/revenue/assessments/:id/remit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const body = remitBody.parse(req.body);
    const result = await commands.remitAssessment(ctx, id, body as unknown as Record<string, unknown>);
    return reply.code(202).send({ data: result });
  });

  // ── PATCH /v1/revenue/assessments/:id/remit-decide → 202 ────────────────
  app.patch("/v1/revenue/assessments/:id/remit-decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const body = remitDecideBody.parse(req.body);
    const result = await commands.remitDecide(ctx, id, body as unknown as Record<string, unknown>);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/revenue/assessments → paginated 200 ─────────────────────────
  app.get("/v1/revenue/assessments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const q = paginationQuery.parse(req.query);
    const { data, total } = await repo.listAssessments(ctx.tenantId, q);
    return reply.send({
      data,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // ── GET /v1/revenue/demands → tenant-scoped flat list ───────────────────────
  app.get("/v1/revenue/demands", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const q = paginationQuery.parse(req.query);
    const result = await repo.listAllDemands(ctx.tenantId, q);
    return reply.send(result);
  });

  // ── GET /v1/revenue/assessees/:id/demands → demands list ────────────────
  app.get("/v1/revenue/assessees/:id/demands", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const data = await repo.listDemands(ctx.tenantId, id);
    return reply.send({ data });
  });

  // ── GET /v1/revenue/assessees/:id/dcb → DCB summary ─────────────────────
  app.get("/v1/revenue/assessees/:id/dcb", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const data = await repo.getDcbSummary(ctx.tenantId, id);
    return reply.send({ data });
  });
}
