import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { uuidParam, paginationQuery } from "../../shared/validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import { istToday } from "./recovery-notice.js";
import {
  createInstalmentBody,
  instalmentDecideBody,
  listInstalmentsQuery,
  createWriteOffBody,
  writeOffDecideBody,
  createRecoveryReferralBody,
  recoveryReferralListQuery,
  recoveryDecideBody,
  serveDemandNoticeBody,
  createWaiverBody,
  waiverDecideBody,
    listWaiversQuery,
  listWriteOffsQuery,
} from "./validators.js";

const REVENUE_ROLES = ["revenue_admin", "revenue_officer", "finance_admin", "super_admin", "tenant_admin"];

/** Owner decision #6: pre-decision rows have no demand — surface "legacy, not linked" instead of hiding it. */
function withLegacyFlag<T extends { demandId?: string | null }>(row: T): T & { legacyUnlinked: boolean } {
  return { ...row, legacyUnlinked: row.demandId == null };
}

export async function arrearsRoutes(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: error.message } });
    }
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    }
    // Fastify-native 4xx (malformed JSON, 413, 415, 429 ...) are client errors, not 500s. Generic message only.
    const sc = (error as { statusCode?: number }).statusCode;
    if (typeof sc === "number" && sc >= 400 && sc < 500) {
      return reply.code(sc).send({ error: { code: "BAD_REQUEST", message: "bad request" } });
    }
    req.log.error({ err: error }, "unhandled error");
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
    // Owner decision #6: the write-off is bound to ONE demand and capped at
    // that demand's live balance. Refuse synchronously; the consumer
    // re-enforces both in-transaction.
    const target = await repo.getWriteOffTarget(ctx.tenantId, body.demandId);
    if (!target) throw new HttpError(404, "DEMAND_NOT_FOUND", "demand not found");
    if (target.assesseeId !== body.assesseeId) {
      throw new HttpError(422, "DEMAND_ASSESSEE_MISMATCH", "the demand does not belong to this assessee");
    }
    if (BigInt(body.amountMinor) > target.balanceMinor) {
      throw new HttpError(422, "WRITEOFF_EXCEEDS_DEMAND_BALANCE", "amount exceeds the balance of the selected demand");
    }
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
      data: rows.map(withLegacyFlag),
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
    return reply.send({ data: withLegacyFlag(writeOff) });
  });

  // ── PATCH /v1/revenue/write-offs/:id/decide ─────────────────────────────────

  app.patch("/v1/revenue/write-offs/:id/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const body = writeOffDecideBody.parse(req.body);
    // Synchronous pre-check (409) — see collection/routes.ts refund decide.
    const writeOff = await repo.findWriteOffById(ctx.tenantId, id);
    if (!writeOff) throw new HttpError(404, "NOT_FOUND", "write-off not found");
    if (writeOff.status !== "pending") {
      throw new HttpError(409, "WRITE_OFF_NOT_PENDING", `write-off is already ${writeOff.status}`);
    }
    if (writeOff.makerUserId === ctx.actorId) {
      throw new HttpError(409, "MAKER_CHECKER_VIOLATION", "the maker of a write-off cannot decide it (separation of duties)");
    }
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

  // ── POST /v1/revenue/demand-notices (owner decision #4) ─────────────────────
  // Record that a demand notice was served. A recovery referral is allowed only
  // after a served notice's period has lapsed.
  app.post("/v1/revenue/demand-notices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = serveDemandNoticeBody.parse(req.body);
    // Synchronous pre-checks: the serve consumer runs after the 202, so these
    // failures would otherwise be silent (the notice would never appear).
    if (body.servedOn > istToday()) {
      throw new HttpError(422, "NOTICE_DATE_IN_FUTURE", "a demand notice cannot be recorded as served on a future date");
    }
    const pre = await repo.precheckDemandNotice(ctx.tenantId, body);
    if (!pre.assesseeExists) throw new HttpError(404, "NOT_FOUND", "assessee not found");
    if (body.demandId) {
      if (pre.demandAssesseeId == null) throw new HttpError(404, "NOT_FOUND", "demand not found");
      if (pre.demandAssesseeId !== body.assesseeId) {
        throw new HttpError(422, "DEMAND_ASSESSEE_MISMATCH", "the demand does not belong to this assessee");
      }
    }
    if (pre.noticeExists) throw new HttpError(409, "DUPLICATE_NOTICE_NO", "a demand notice with this number already exists");
    const result = await commands.serveDemandNotice(ctx, body as unknown as Record<string, unknown>);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/revenue/assessees/:id/recovery-readiness (owner decision #4) ────
  // Amount outstanding, notices served (and whether their period lapsed) and
  // eligibility — shown to the officer before they raise a coercive referral.
  app.get("/v1/revenue/assessees/:id/recovery-readiness", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const r = await repo.getRecoveryReadiness(ctx.tenantId, id);
    return reply.send({ data: { ...r, outstandingMinor: r.outstandingMinor.toString() } });
  });

  // ── GET /v1/revenue/recovery-referrals/:id ──────────────────────────────────
  app.get("/v1/revenue/recovery-referrals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const referral = await repo.findRecoveryReferralById(ctx.tenantId, id);
    if (!referral) throw new HttpError(404, "NOT_FOUND", "recovery referral not found");
    return reply.send({ data: referral });
  });

  // ── PATCH /v1/revenue/recovery-referrals/:id/decide (checker step) ──────────
  app.patch("/v1/revenue/recovery-referrals/:id/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const body = recoveryDecideBody.parse(req.body);
    // Synchronous pre-check (409) — the consumer re-enforces both in-transaction.
    const referral = await repo.findRecoveryReferralById(ctx.tenantId, id);
    if (!referral) throw new HttpError(404, "NOT_FOUND", "recovery referral not found");
    if (referral.status !== "pending") {
      throw new HttpError(409, "RECOVERY_NOT_PENDING", `recovery referral is already ${referral.status}`);
    }
    if (referral.createdBy === ctx.actorId) {
      throw new HttpError(409, "MAKER_CHECKER_VIOLATION", "the maker of a recovery referral cannot decide it (separation of duties)");
    }
    const result = await commands.decideRecoveryReferral(ctx, id, body as unknown as Record<string, unknown>);
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
      q.status,
    );
    return reply.send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // ── GET /v1/revenue/instalments (checker queue, owner decision #3) ─────────
  app.get("/v1/revenue/instalments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const q = listInstalmentsQuery.parse(req.query);
    const { rows, total } = await repo.listInstalmentPlansByStatus(ctx.tenantId, {
      ...(q.status ? { status: q.status } : {}),
      limit: q.limit,
      offset: q.offset,
    });
    return reply.send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // ── PATCH /v1/revenue/instalments/:id/decide (checker step, owner decision #3) ─
  // An instalment plan defers a demand, so a DIFFERENT officer must approve it.
  app.patch("/v1/revenue/instalments/:id/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const body = instalmentDecideBody.parse(req.body);
    // Synchronous pre-check (409) — the consumer re-enforces both in-transaction.
    const plan = await repo.findInstalmentPlanById(ctx.tenantId, id);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "instalment plan not found");
    if (plan.status !== "pending") {
      throw new HttpError(409, "INSTALMENT_NOT_PENDING", `instalment plan is already ${plan.status}`);
    }
    if (plan.createdBy === ctx.actorId) {
      throw new HttpError(409, "MAKER_CHECKER_VIOLATION", "the maker of an instalment plan cannot decide it (separation of duties)");
    }
    const result = await commands.decideInstalmentPlan(ctx, id, body as unknown as Record<string, unknown>);
    return reply.code(202).send({ data: result });
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

  // ── GET /v1/revenue/waivers ─────────────────────────────────────────────────
  // Tenant-scoped, paginated list so a checker can DISCOVER pending waivers
  // (?status=pending) instead of pasting a UUID from the maker. Role-guarded
  // like every other arrears route. Declared before /waivers/:id.

  app.get(
    "/v1/revenue/waivers",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, REVENUE_ROLES);
      const q = listWaiversQuery.parse(req.query);
      const { rows, total } = await repo.listWaivers(ctx.tenantId, {
        ...(q.status ? { status: q.status } : {}),
        limit: q.limit,
        offset: q.offset,
      });
      return reply.send({
        data: rows,
        meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
      });
    },
  );

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
    const waiver = await repo.findWaiverById(ctx.tenantId, id);
    if (!waiver) throw new HttpError(404, "NOT_FOUND", "waiver not found");
    if (waiver.status !== "pending") {
      throw new HttpError(409, "WAIVER_NOT_PENDING", `waiver is already ${waiver.status}`);
    }
    if (waiver.requestedBy === ctx.actorId) {
      throw new HttpError(409, "MAKER_CHECKER_VIOLATION", "the requester of a waiver cannot decide it (separation of duties)");
    }
    return reply.code(202).send({ data: await commands.decideWaiver(ctx, id, body as unknown as Record<string, unknown>) });
  };

  app.post("/v1/revenue/waivers/:id/decide", decideWaiverHandler);
  app.patch("/v1/revenue/waivers/:id/decide", decideWaiverHandler);
}
