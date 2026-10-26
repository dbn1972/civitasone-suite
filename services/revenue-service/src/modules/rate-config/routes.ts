import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { uuidParam } from "../../shared/validators.js";
import { istToday } from "../arrears/recovery-notice.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import { previewProposal, type Proposal } from "./domain.js";
import { proposeBody, decideBody, proposalListQuery, previewQuery } from "./validators.js";

const REVENUE_ROLES = ["revenue_admin", "revenue_officer", "finance_admin", "super_admin", "tenant_admin"];
/** Owner decision #2: revenue_admin proposes (a DIFFERENT officer then approves). */
const PROPOSER_ROLES = ["revenue_admin", "super_admin"];

export async function rateConfigRoutes(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: error.message } });
    }
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    }
    const sc = (error as { statusCode?: number }).statusCode;
    if (typeof sc === "number" && sc >= 400 && sc < 500) {
      return reply.code(sc).send({ error: { code: "BAD_REQUEST", message: "bad request" } });
    }
    req.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal server error" } });
  });

  // ── POST /v1/revenue/rate-config/proposals (maker step) ────────────────────
  app.post("/v1/revenue/rate-config/proposals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROPOSER_ROLES);
    const body = proposeBody.parse(req.body);
    if (body.effectiveFrom < istToday()) {
      throw new HttpError(422, "EFFECTIVE_DATE_IN_PAST", "Rate configuration changes cannot be effective in the past");
    }
    const result = await commands.proposeConfigChange(ctx, body as unknown as Record<string, unknown>);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/revenue/rate-config/proposals (the checker queue + history) ────
  app.get("/v1/revenue/rate-config/proposals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const q = proposalListQuery.parse(req.query);
    const { rows, total } = await repo.listProposals(ctx.tenantId, {
      ...(q.status ? { status: q.status } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      limit: q.limit,
      offset: q.offset,
    });
    return reply.send({ data: rows, meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/v1/revenue/rate-config/proposals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const row = await repo.findProposalById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "proposal not found");
    return reply.send({ data: row });
  });

  // ── GET /v1/revenue/rate-config/proposals/:id/preview ──────────────────────
  // What the change does to a computed demand, BEFORE anyone approves it.
  app.get("/v1/revenue/rate-config/proposals/:id/preview", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const q = previewQuery.parse(req.query);
    const row = await repo.findProposalById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "proposal not found");
    const state = await repo.loadConfigState(ctx.tenantId);
    const proposal: Proposal = {
      id: row.id, kind: row.kind as Proposal["kind"], action: row.action as Proposal["action"],
      targetId: row.targetId ?? null, rateHeadId: row.rateHeadId ?? null,
      effectiveFrom: typeof row.effectiveFrom === "string" ? row.effectiveFrom : String(row.effectiveFrom),
      payload: (row.payload ?? {}) as Record<string, unknown>,
    };
    const preview = previewProposal(state, proposal, { today: istToday(), baseValue: BigInt(q.baseValue) });
    return reply.send({ data: preview });
  });

  // ── PATCH /v1/revenue/rate-config/proposals/:id/decide (checker step) ──────
  app.patch("/v1/revenue/rate-config/proposals/:id/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const body = decideBody.parse(req.body);
    // Synchronous pre-check (409) — the consumer re-enforces both in-transaction.
    const row = await repo.findProposalById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "proposal not found");
    if (row.status !== "pending") {
      throw new HttpError(409, "PROPOSAL_NOT_PENDING", `proposal is already ${row.status}`);
    }
    if (row.makerUserId === ctx.actorId) {
      throw new HttpError(409, "MAKER_CHECKER_VIOLATION", "the maker of a rate-config proposal cannot decide it (separation of duties)");
    }
    const result = await commands.decideConfigProposal(ctx, id, body as unknown as Record<string, unknown>);
    return reply.code(202).send({ data: result });
  });
}
