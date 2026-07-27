/**
 * cycle-count consumer — handles cycle count create, approve, and reject commands.
 *
 * Every handler:
 *   1. dedupes via markProcessed (idempotency),
 *   2. mutates inside a single transaction with a transactional-outbox event,
 *   3. invalidates the read cache after commit.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, INTEGRATION, RESOURCE } from "../../topics.js";
import { cycleCounts } from "./schema.js";
import { evaluateCycleCount } from "./domain.js";

type EnqueueTx = Parameters<typeof enqueue>[0];

export function registerCycleCountConsumers(q: Queue): void {
  q.subscribe(COMMANDS.cycleCountCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; itemId: string; warehouseId: string;
      physicalQty: number; reasonCode: string; countedAt?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Look up current system qty (simplified — use balance 0 if unknown)
      const systemQty = 0; // In full implementation, query stock balance
      const result = evaluateCycleCount({
        systemQty,
        physicalQty: p.physicalQty,
        reasonCode: p.reasonCode,
      });

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
        countedAt: p.countedAt ? new Date(p.countedAt) : new Date(),
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
  });

  q.subscribe(COMMANDS.cycleCountApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
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
          ),
        )
        .returning();

      if (!updated) return;

      await enqueue(tx as EnqueueTx, {
        topic: EVENTS.cycleCountApproved, eventType: EVENTS.cycleCountApproved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, itemId: updated.itemId, warehouseId: updated.warehouseId, variance: updated.variance, approvedBy: msg.actorId },
      });
      await audit(tx as EnqueueTx, msg, "approve", p.id);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE.cycleCount);
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
