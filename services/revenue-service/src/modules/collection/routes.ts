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
  createAdjustmentBody,
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

  app.post("/v1/revenue/adjustments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const body = createAdjustmentBody.parse(req.body);
    const result = await commands.createAdjustment(ctx, body);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/revenue/assessees/:id/receipts ────────────────────────────────

  app.get("/v1/revenue/assessees/:id/receipts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id: assesseeId } = uuidParam.parse(req.params);
    const q = paginationQuery.parse(req.query);
    const rows = await repo.listReceipts(ctx.tenantId, assesseeId, q);
    return reply.send({
      data: rows.slice(q.offset, q.offset + q.limit),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: rows.length },
    });
  });
}
