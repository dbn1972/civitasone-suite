/**
 * cycle-count consumer — handles cycle count create, approve, and reject commands.
 *
 * Every handler:
 *   1. dedupes via markProcessed (idempotency),
 *   2. mutates inside a single transaction with a transactional-outbox event,
 *   3. invalidates the read cache after commit.
 */
import { randomUUID } from "node:crypto";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { eq, and, ne } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, INTEGRATION, RESOURCE } from "../../topics.js";
import { cycleCounts } from "./schema.js";
import { evaluateCycleCount } from "./domain.js";
import * as stockRepo from "../movements/repo.js";
import type { Tx } from "../movements/repo.js";

type EnqueueTx = Parameters<typeof enqueue>[0];

/**
 * Posts a cycle count's variance into the shared stock model (stock_balances
 * + stock_ledger), following the exact pattern movements/consumer.ts's own
 * `adjustmentCreate` handler uses for its stock adjustments:
 *   - read + lock the CURRENT balance at post time (not a stale snapshot --
 *     for the approve path this can run long after create, and diffing
 *     against fresh current balance means an intervening movement is never
 *     silently overwritten, same as adjustmentCreate);
 *   - always upsert on-hand to the physically counted qty (idempotent no-op
 *     if it already matches -- this is the "should a zero-variance count
 *     still post" case: yes, so the count is on record, it just moves
 *     nothing);
 *   - always write a movements header + line, so the correction is visible
 *     through the normal movements/ledger listing and audit trail, tied
 *     back to its originating cycle count via ref_doc/ref_no;
 *   - append a stock_ledger row only when the balance actually changed
 *     (diff !== 0), same guard adjustmentCreate uses.
 *
 * movement_type is 'adjustment', not a new 'cycle_count' literal: both
 * inventory.movements and inventory.stock_ledger have a CHECK constraint
 * (migration 0008) restricting movement_type to
 * ('receipt','issue','transfer','adjustment') -- a cycle count's resulting
 * stock correction IS an adjustment, just triggered by a count instead of a
 * manual entry.
 *
 * cycle_counts.warehouse_id (passed here as `storeId`) is, despite its name,
 * an inventory.stores id: stock_balances/stock_ledger/movements are all
 * keyed (and FK'd, for stock_balances/movements) on inventory.stores, and
 * this service has no separate warehouse-to-store mapping --
 * 0010_canonical_warehouses.sql's `warehouses` table is an unrelated,
 * higher-level master-data concept for a future stock-service unification
 * that nothing here links to stores or stock_balances (yet).
 *
 * reasonCode is truncated to 32 chars: cycle_counts.reason_code is
 * varchar(64) (matching validators.ts's zod cap), but
 * movements/stock_ledger.reason_code is varchar(32) -- inserting an
 * untruncated 33-64 char reason would violate that column's width. The
 * cycle_counts row (linked via ref_no) keeps the untruncated reason.
 */
async function postReconciliation(
  tx: Tx,
  params: {
    tenantId: string; actorId: string; cycleCountId: string;
    itemId: string; storeId: string; physicalQty: number;
    reasonCode: string; postedAt: Date;
  },
): Promise<{ movementId: string; diff: number }> {
  const { tenantId, actorId, cycleCountId, itemId, storeId, physicalQty, reasonCode, postedAt } = params;
  const postingDate = postedAt.toISOString().slice(0, 10);
  const truncatedReason = reasonCode.slice(0, 32);
  const movementId = randomUUID();

  const cur = await stockRepo.lockBalance(tx, tenantId, itemId, storeId);
  const diff = physicalQty - cur.qty;

  await stockRepo.insertMovement(tx, {
    id: movementId, tenantId, movementType: "adjustment",
    refDoc: "CYCLE_COUNT", refNo: cycleCountId, postingDate,
    fromStoreId: null, toStoreId: storeId,
    reasonCode: truncatedReason, notes: null,
    status: "posted", createdBy: actorId, updatedBy: actorId,
  });
  await stockRepo.insertMovementLines(tx, [{
    id: randomUUID(), tenantId, movementId, itemId,
    qty: physicalQty, rateMinor: cur.rateMinor, amountMinor: cur.rateMinor * BigInt(physicalQty),
    currency: "INR",
  }]);
  await stockRepo.upsertBalance(tx, tenantId, itemId, storeId, physicalQty, cur.rateMinor, "INR");

  if (diff !== 0) {
    await stockRepo.appendLedger(tx, {
      id: randomUUID(), tenantId, itemId, storeId, movementId, movementType: "adjustment",
      qtyIn: Math.max(0, diff), qtyOut: Math.max(0, -diff), balanceQty: physicalQty,
      rateMinor: cur.rateMinor, valueMinor: cur.rateMinor * BigInt(physicalQty),
      currency: "INR", reasonCode: truncatedReason, postingDate, createdBy: actorId,
    });
  }

  return { movementId, diff };
}

export function registerCycleCountConsumers(q: Queue): void {
  q.subscribe(COMMANDS.cycleCountCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; itemId: string; warehouseId: string;
      physicalQty: number; reasonCode: string; countedAt?: string;
    };
    let reconciled = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Real system-qty lookup (was hardcoded to 0 — see postReconciliation()'s
      // doc comment for why `p.warehouseId` is the storeId lockBalance expects).
      // lockBalance both reads the qty for the snapshot below and takes the row
      // lock this same transaction needs if it goes on to auto-post, so
      // concurrent movements on this (item, store) serialise against the whole
      // create instead of racing it — and re-locking it inside
      // postReconciliation() below (same open transaction, lock already held)
      // is guaranteed to see the identical value, so the recorded variance and
      // the posted diff can never disagree for the auto-post path.
      const countedAt = p.countedAt ? new Date(p.countedAt) : new Date();
      const { qty: systemQty } = await stockRepo.lockBalance(tx, msg.tenantId, p.itemId, p.warehouseId);
      const result = evaluateCycleCount({
        systemQty,
        physicalQty: p.physicalQty,
        reasonCode: p.reasonCode,
      });

      let adjustmentId: string | null = null;
      if (result.status === "auto_posted") {
        const posted = await postReconciliation(tx, {
          tenantId: msg.tenantId, actorId: msg.actorId, cycleCountId: p.id,
          itemId: p.itemId, storeId: p.warehouseId, physicalQty: p.physicalQty,
          reasonCode: p.reasonCode, postedAt: countedAt,
        });
        adjustmentId = posted.movementId;
        reconciled = true;
      }

      await tx.insert(cycleCounts).values({
        id: p.id,
        tenantId: msg.tenantId,
        itemId: p.itemId,
        warehouseId: p.warehouseId,
        systemQty,
        physicalQty: p.physicalQty,
        variance: result.variance,
        absVariance: result.absVariance,
        autoAdjustThreshold: result.autoAdjustThreshold,
        reasonCode: p.reasonCode,
        status: result.status,
        adjustmentId,
        countedAt,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      if (result.status === "auto_posted") {
        await enqueue(tx as EnqueueTx, {
          topic: EVENTS.cycleCountAutoPosted, eventType: EVENTS.cycleCountAutoPosted,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { id: p.id, itemId: p.itemId, warehouseId: p.warehouseId, variance: result.variance, status: "auto_posted" },
        });
      }

      await audit(tx as EnqueueTx, msg, "create", p.id);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE.cycleCount);
    if (reconciled) {
      // Mirrors movements/consumer.ts's own invalidate() helper — without
      // this, GET /v1/inventory/balances and /ledger keep serving the
      // pre-reconciliation cached values after an auto-posted cycle count.
      await cache.invalidateResource(msg.tenantId, RESOURCE.balance);
      await cache.invalidateResource(msg.tenantId, RESOURCE.ledger);
    }
  });

  q.subscribe(COMMANDS.cycleCountApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    let reconciled = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const [updated] = await tx
        .update(cycleCounts)
        .set({
          status: "approved",
          approvedBy: msg.actorId,
          approvedAt: new Date(),
          updatedBy: msg.actorId,
          updatedAt: new Date(),
          version: p.version + 1,
        })
        .where(
          and(
            eq(cycleCounts.id, p.id),
            eq(cycleCounts.tenantId, msg.tenantId),
            eq(cycleCounts.version, p.version),
            eq(cycleCounts.status, "pending_approval"),
            // Maker != checker, enforced where the write happens (the route
            // pre-check can be raced or bypassed by a direct queue publish).
            ne(cycleCounts.createdBy, msg.actorId),
          ),
        )
        .returning();

      if (!updated) {
        // Not applied. If it was refused as a self-approval (e.g. the route's
        // cached pre-check was stale), leave an audit trail instead of a silent no-op.
        const [existing] = await tx.select({ createdBy: cycleCounts.createdBy }).from(cycleCounts)
          .where(and(eq(cycleCounts.id, p.id), eq(cycleCounts.tenantId, msg.tenantId)));
        if (existing && existing.createdBy === msg.actorId) {
          await audit(tx as EnqueueTx, msg, "approve_refused_maker_checker", p.id);
        }
        return;
      }

      // Post the reconciling stock entry now that a human has approved this
      // variance (see postReconciliation()'s doc comment: diffs against the
      // CURRENT balance at approval time, not the systemQty snapshot taken at
      // create time — matches movements/consumer.ts's own adjustmentCreate
      // handler, and means an intervening movement between create and
      // approval is never silently overwritten).
      const posted = await postReconciliation(tx, {
        tenantId: msg.tenantId, actorId: msg.actorId, cycleCountId: p.id,
        itemId: updated.itemId, storeId: updated.warehouseId, physicalQty: updated.physicalQty,
        reasonCode: updated.reasonCode, postedAt: updated.countedAt,
      });
      reconciled = true;
      await tx.update(cycleCounts)
        .set({ adjustmentId: posted.movementId })
        .where(and(eq(cycleCounts.id, p.id), eq(cycleCounts.tenantId, msg.tenantId)));

      await enqueue(tx as EnqueueTx, {
        topic: EVENTS.cycleCountApproved, eventType: EVENTS.cycleCountApproved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, itemId: updated.itemId, warehouseId: updated.warehouseId, variance: updated.variance, approvedBy: msg.actorId },
      });
      await audit(tx as EnqueueTx, msg, "approve", p.id);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE.cycleCount);
    if (reconciled) {
      // See the matching comment in the create handler above.
      await cache.invalidateResource(msg.tenantId, RESOURCE.balance);
      await cache.invalidateResource(msg.tenantId, RESOURCE.ledger);
    }
  });

  q.subscribe(COMMANDS.cycleCountReject, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const [updated] = await tx
        .update(cycleCounts)
        .set({
          status: "rejected",
          rejectedBy: msg.actorId,
          rejectedAt: new Date(),
          rejectionReason: p.reason,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
          version: p.version + 1,
        })
        .where(
          and(
            eq(cycleCounts.id, p.id),
            eq(cycleCounts.tenantId, msg.tenantId),
            eq(cycleCounts.version, p.version),
            eq(cycleCounts.status, "pending_approval"),
          ),
        )
        .returning();

      if (!updated) return;

      await enqueue(tx as EnqueueTx, {
        topic: EVENTS.cycleCountRejected, eventType: EVENTS.cycleCountRejected,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, itemId: updated.itemId, warehouseId: updated.warehouseId, reason: p.reason },
      });
      await audit(tx as EnqueueTx, msg, "reject", p.id);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE.cycleCount);
  });
}

async function audit(tx: EnqueueTx, msg: CommandEnvelope, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: INTEGRATION.audit, eventType: INTEGRATION.audit,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "inventory", action, resourceType: "cycle_count", resourceId, outcome: "success" },
  });
}
