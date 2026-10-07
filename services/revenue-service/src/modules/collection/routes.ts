import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { uuidParam, paginationQuery } from "../../shared/validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import {
  createReceiptBody,
  createBatchReceiptBody,
  createRefundBody,
  refundDecideBody,
  refundListQuery,
  createAdjustmentBody,
  adjustmentDecideBody,
  adjustmentListQuery,
} from "./validators.js";

const REVENUE_ROLES = ["revenue_admin", "revenue_officer", "finance_admin", "super_admin", "tenant_admin"];

export async function collectionRoutes(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: error.message } });
    }
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    }
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal server error" } });
  });

  // ── POST /v1/revenue/receipts ─────────────────────────────────────────────

  app.post("/v1/revenue/receipts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = createReceiptBody.parse(req.body);
    const result = await commands.createReceipt(ctx, body);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/revenue/receipts/batch ───────────────────────────────────────

  app.post("/v1/revenue/receipts/batch", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = createBatchReceiptBody.parse(req.body);
    const result = await commands.createBatchReceipt(ctx, body);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/revenue/refunds ──────────────────────────────────────────────

  app.post("/v1/revenue/refunds", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = createRefundBody.parse(req.body);
    const result = await commands.createRefund(ctx, body);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/revenue/refunds ────────────────────────────────────────────────
  // The refund register (GAP-REVENUE-REFUNDS-01): a checker must be able to
  // find refunds awaiting approval without being handed a UUID out of band.
  // Tenant-scoped; optional ?status=pending filter.

  app.get("/v1/revenue/refunds", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const q = refundListQuery.parse(req.query);
    const { rows, total } = await repo.listRefunds(ctx.tenantId, { limit: q.limit, offset: q.offset }, q.status);
    return reply.send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // ── GET /v1/revenue/refunds/:id ────────────────────────────────────────────
  // Tenant-scoped single-record fetch so the maker-checker decide screen can
  // show the checker the amount/receipt/reason before they approve or reject
  // — never decide blind on a bare UUID.

  app.get("/v1/revenue/refunds/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const refund = await repo.findRefundById(ctx.tenantId, id);
    if (!refund) {
      throw new HttpError(404, "NOT_FOUND", "refund not found");
    }
    return reply.send({ data: refund });
  });

  // ── PATCH /v1/revenue/refunds/:id/decide ──────────────────────────────────

  app.patch("/v1/revenue/refunds/:id/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const body = refundDecideBody.parse(req.body);
    const result = await commands.decideRefund(ctx, id, body);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/revenue/adjustments ──────────────────────────────────────────
  // GAP-REVENUE-ADJUSTMENTS-01: maker step — records a PENDING transfer. The
  // balance is only moved after a distinct checker approves it via
  // PATCH /adjustments/:id/decide.

  app.post("/v1/revenue/adjustments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = createAdjustmentBody.parse(req.body);
    const result = await commands.createAdjustment(ctx, body);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/revenue/adjustments ────────────────────────────────────────────
  // GAP-REVENUE-ADJUSTMENTS-01: the adjustment approval queue — a checker finds
  // transfers awaiting approval (?status=pending) without being handed a UUID
  // out of band. Tenant-scoped; optional status filter.

  app.get("/v1/revenue/adjustments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const q = adjustmentListQuery.parse(req.query);
    const { rows, total } = await repo.listAdjustmentsByStatus(ctx.tenantId, { limit: q.limit, offset: q.offset }, q.status);
    return reply.send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // ── GET /v1/revenue/adjustments/:id ────────────────────────────────────────
  // GAP-REVENUE-ADJUSTMENTS-01: single-record fetch so the maker-checker decide
  // screen can show the checker the amount + from/to demand + who raised it
  // before they approve or reject — never decide blind on a bare UUID.

  app.get("/v1/revenue/adjustments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const adjustment = await repo.findAdjustmentById(ctx.tenantId, id);
    if (!adjustment) {
      throw new HttpError(404, "NOT_FOUND", "adjustment not found");
    }
    return reply.send({ data: adjustment });
  });

  // ── PATCH /v1/revenue/adjustments/:id/decide ───────────────────────────────
  // GAP-REVENUE-ADJUSTMENTS-01: checker step — approve/reject a pending
  // transfer. The consumer enforces maker!=checker (assertMakerChecker) and
  // only moves the balance on approve.

  app.patch("/v1/revenue/adjustments/:id/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const body = adjustmentDecideBody.parse(req.body);
    // Pre-check synchronously so a self-approval / stale decide is a visible
    // 403/409 to the caller instead of a silent consumer retry with no audit.
    const adjustment = await repo.findAdjustmentById(ctx.tenantId, id);
    if (!adjustment) throw new HttpError(404, "NOT_FOUND", "adjustment not found");
    if (adjustment.status !== "pending") {
      throw new HttpError(409, "ADJUSTMENT_NOT_PENDING", `adjustment is already ${adjustment.status}`);
    }
    if (adjustment.makerUserId === ctx.actorId) {
      throw new HttpError(403, "MAKER_CHECKER_VIOLATION", "the maker of an adjustment cannot decide it (separation of duties)");
    }
    const result = await commands.decideAdjustment(ctx, id, body);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/revenue/assessees/:id/receipts ────────────────────────────────

  app.get("/v1/revenue/assessees/:id/receipts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id: assesseeId } = uuidParam.parse(req.params);
    const q = paginationQuery.parse(req.query);
    const { rows, total } = await repo.listReceipts(ctx.tenantId, assesseeId, q);
    return reply.send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // ── GET /v1/revenue/assessees/:id/adjustments ─────────────────────────────
  // GAP-REVENUE-ADJUSTMENTS-02: an adjustment register so the officer can see
  // what balance was moved between demands (there was no list endpoint before).
  app.get("/v1/revenue/assessees/:id/adjustments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id: assesseeId } = uuidParam.parse(req.params);
    const q = paginationQuery.parse(req.query);
    const { rows, total } = await repo.listAdjustments(ctx.tenantId, assesseeId, q);
    return reply.send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });
}
