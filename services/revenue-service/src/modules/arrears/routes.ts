import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
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
  recoveryReferralListQuery,
  createWaiverBody,
  waiverDecideBody,
  listWriteOffsQuery,
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

  // ── GET /v1/revenue/write-offs ──────────────────────────────────────────────
  // GAP-REVENUE-WRITE-OFFS-02: tenant-scoped, paginated list so a checker can
  // DISCOVER pending write-offs (?status=pending) instead of pasting a UUID
  // from the maker. Role-guarded like every other arrears route.

  app.get("/v1/revenue/write-offs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const q = listWriteOffsQuery.parse(req.query);
    const { rows, total } = await repo.listWriteOffs(ctx.tenantId, {
      ...(q.status ? { status: q.status } : {}),
      limit: q.limit,
      offset: q.offset,
    });
    return reply.send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // ── GET /v1/revenue/write-offs/:id ──────────────────────────────────────────
  // Tenant-scoped single-record fetch so the maker-checker decide screen can
  // show the checker the amount/assessee/reason before they approve or reject
  // — never decide blind on a bare UUID.

  app.get("/v1/revenue/write-offs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const writeOff = await repo.findWriteOffById(ctx.tenantId, id);
    if (!writeOff) {
      throw new HttpError(404, "NOT_FOUND", "write-off not found");
    }
    return reply.send({ data: writeOff });
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

  // ── GET /v1/revenue/recovery-referrals ──────────────────────────────────────
  // The recovery register (GAP-REVENUE-RECOVERY-02): a coercive referral takes
  // effect immediately, so who referred whom (and when, and why) must be
  // listable, not write-only. Tenant-scoped; optional ?assesseeId filter.

  app.get("/v1/revenue/recovery-referrals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const q = recoveryReferralListQuery.parse(req.query);
    const { rows, total } = await repo.listRecoveryReferrals(
      ctx.tenantId,
      { limit: q.limit, offset: q.offset },
      q.assesseeId,
    );
    return reply.send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // ── GET /v1/revenue/instalments/:id ─────────────────────────────────────────
  // Instalment plan detail + schedule lines (GAP-REVENUE-INSTALMENTS-02), so a
  // plan links to its per-instalment breakdown instead of being a dead row.

  app.get("/v1/revenue/instalments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const plan = await repo.findInstalmentPlanById(ctx.tenantId, id);
    if (!plan) {
      throw new HttpError(404, "NOT_FOUND", "instalment plan not found");
    }
    return reply.send({ data: plan });
  });

  // ── GET /v1/revenue/assessees/:id/instalments ───────────────────────────────

  app.get("/v1/revenue/assessees/:id/instalments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id: assesseeId } = uuidParam.parse(req.params);
    const q = paginationQuery.parse(req.query);
    const { rows, total } = await repo.listInstalmentPlans(ctx.tenantId, assesseeId, q);
    return reply.send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // ── POST /v1/revenue/waivers ────────────────────────────────────────────────

  app.post("/v1/revenue/waivers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = createWaiverBody.parse(req.body);
    return reply.code(202).send({ data: await commands.createWaiver(ctx, body as unknown as Record<string, unknown>) });
  });

  // ── GET /v1/revenue/waivers/:id ─────────────────────────────────────────────
  // GAP-REVENUE-WAIVERS-03: tenant-scoped single-record fetch so the
  // maker-checker decide screen can show the amount/demand/reason/requester
  // before approving or rejecting — never decide blind on a bare UUID.

  app.get("/v1/revenue/waivers/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const waiver = await repo.findWaiverById(ctx.tenantId, id);
    if (!waiver) {
      throw new HttpError(404, "NOT_FOUND", "waiver not found");
    }
    return reply.send({ data: waiver });
  });

  // ── Decide a waiver ─────────────────────────────────────────────────────────
  // Accept both POST (original) and PATCH (consistent with refunds/write-offs
  // decide, which the web decide form uses). GAP-REVENUE-WAIVERS-03.

  const decideWaiverHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const body = waiverDecideBody.parse(req.body);
    return reply.code(202).send({ data: await commands.decideWaiver(ctx, id, body as unknown as Record<string, unknown>) });
  };

  app.post("/v1/revenue/waivers/:id/decide", decideWaiverHandler);
  app.patch("/v1/revenue/waivers/:id/decide", decideWaiverHandler);
}
