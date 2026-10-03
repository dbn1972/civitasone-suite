/**
 * Stock-movement HTTP routes — receipts, issues, transfers, adjustments (writes)
 * plus balances, ledger and the low-stock report (reads). Writes are role-gated
 * and enqueued; reads are tenant-scoped and cache-first.
 */
import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, registerErrorHandler, HttpError } from "../../shared/context.js";
import {
  createReceiptBody, createIssueBody, createTransferBody, createAdjustmentBody,
  balanceQueryParams, ledgerQueryParams, lowStockQueryParams, idParam,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import type { LedgerOpts } from "./repo.js";
import { resolveUserNames } from "../../shared/identity-client.js";

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
  // The only way a caller can learn a receipt/issue/transfer/adjustment's
  // outcome: a rejected or still-retrying command never persists a row, so
  // this 404s exactly like a rejected batch.issue/srn.create does — same
  // GET-by-id contract as batches/items/srn, just previously missing here.
  app.get("/v1/inventory/movements/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const movement = await queries.getMovement(ctx.tenantId, id);
    if (!movement) throw new HttpError(404, "NOT_FOUND", "movement not found");
    // Lines + poster name make this the target of the "stock adjustment" link on an approved
    // cycle count (GAP-INVENTORY-CYCLE-COUNTS-DETAIL-05). Additive: every existing field is unchanged.
    const [lines, names] = await Promise.all([
      repo.listMovementLines(ctx.tenantId, id),
      resolveUserNames(ctx.tenantId, [movement.createdBy]),
    ]);
    return reply.send({
      data: {
        ...movement,
        createdByName: names.get(movement.createdBy) ?? null,
        lines: lines.map((l) => ({
          id: l.id, itemId: l.itemId, qty: l.qty,
          rateMinor: l.rateMinor.toString(), amountMinor: l.amountMinor.toString(), currency: l.currency,
        })),
      },
    });
  });

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
    const opts: LedgerOpts = { limit: q.limit, offset: q.offset };
    if (q.itemId !== undefined) opts.itemId = q.itemId;
    if (q.storeId !== undefined) opts.storeId = q.storeId;
    if (q.movementType !== undefined) opts.movementType = q.movementType;
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
