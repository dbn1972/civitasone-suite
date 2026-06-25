/**
 * Stock-movement HTTP routes — receipts, issues, transfers, adjustments (writes)
 * plus balances, ledger and the low-stock report (reads). Writes are role-gated
 * and enqueued; reads are tenant-scoped and cache-first.
 */
import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, registerErrorHandler } from "../../shared/context.js";
import {
  createReceiptBody, createIssueBody, createTransferBody, createAdjustmentBody,
  balanceQueryParams, ledgerQueryParams, lowStockQueryParams,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const STORE_ROLES  = ["inventory_user", "inventory_manager", "store_keeper", "inventory_admin", "super_admin"];
const ADJUST_ROLES = ["inventory_manager", "inventory_admin", "super_admin"];
const READER_ROLES = [...STORE_ROLES, "audit_officer", "finance_officer"];

export async function movementRoutes(app: FastifyInstance): Promise<void> {
  // ── Writes ───────────────────────────────────────────────────────────────
  app.post("/v1/inventory/receipts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STORE_ROLES);
    const body = createReceiptBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createReceipt(ctx, body));
  });

  app.post("/v1/inventory/issues", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STORE_ROLES);
    const body = createIssueBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createIssue(ctx, body));
  });

  app.post("/v1/inventory/transfers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STORE_ROLES);
    const body = createTransferBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createTransfer(ctx, body));
  });

  app.post("/v1/inventory/adjustments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADJUST_ROLES);
    const body = createAdjustmentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createAdjustment(ctx, body));
  });

  // ── Reads ───────────────────────────────────────────────────────────────
  app.get("/v1/inventory/balances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = balanceQueryParams.parse(req.query);
    const opts: { itemId?: string; storeId?: string; limit: number; offset: number } = { limit: q.limit, offset: q.offset };
    if (q.itemId !== undefined) opts.itemId = q.itemId;
    if (q.storeId !== undefined) opts.storeId = q.storeId;
    return reply.send(await queries.listBalances(ctx.tenantId, opts));
  });

  app.get("/v1/inventory/ledger", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = ledgerQueryParams.parse(req.query);
    const opts: { itemId?: string; storeId?: string; from?: string; to?: string; limit: number; offset: number } = { limit: q.limit, offset: q.offset };
    if (q.itemId !== undefined) opts.itemId = q.itemId;
    if (q.storeId !== undefined) opts.storeId = q.storeId;
    if (q.from !== undefined) opts.from = q.from;
    if (q.to !== undefined) opts.to = q.to;
    return reply.send(await queries.listLedger(ctx.tenantId, opts));
  });

  app.get("/v1/inventory/low-stock", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = lowStockQueryParams.parse(req.query);
    return reply.send(await queries.listLowStock(ctx.tenantId, q.limit, q.offset));
  });

  registerErrorHandler(app);
}
