/**
 * matching consumer — handles three-way match create and resolve commands.
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
import { threeWayMatches } from "./schema.js";
import { threeWayMatch } from "./domain.js";

type EnqueueTx = Parameters<typeof enqueue>[0];

export function registerMatchingConsumers(q: Queue): void {
  q.subscribe(COMMANDS.threeWayMatchCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string;
      poId: string; poLineId?: string; grnId: string; invoiceId: string;
      poQty: number; poRatePaise: string; grnQty: number;
      invoiceQty: number; invoiceRatePaise: string;
      tolerancePct?: number; toleranceAbsPaise?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const result = threeWayMatch(
        {
          poQty: p.poQty,
          poRatePaise: BigInt(p.poRatePaise),
          grnQty: p.grnQty,
          invoiceQty: p.invoiceQty,
          invoiceRatePaise: BigInt(p.invoiceRatePaise),
        },
        {
          percentageTolerance: p.tolerancePct ?? 5,
          ...(p.toleranceAbsPaise ? { absoluteAmountPaise: BigInt(p.toleranceAbsPaise) } : {}),
        },
      );

      await tx.insert(threeWayMatches).values({
        id: p.id,
        tenantId: msg.tenantId,
        poId: p.poId,
        poLineId: p.poLineId ?? null,
        grnId: p.grnId,
        invoiceId: p.invoiceId,
        poQty: p.poQty,
        poRatePaise: BigInt(p.poRatePaise),
        grnQty: p.grnQty,
        invoiceQty: p.invoiceQty,
        invoiceRatePaise: BigInt(p.invoiceRatePaise),
        status: result.status,
        paymentBlocked: result.paymentBlocked ? 1 : 0,
        tolerancePct: p.tolerancePct ?? 5,
        toleranceAbsPaise: p.toleranceAbsPaise ? BigInt(p.toleranceAbsPaise) : null,
        qtyVariances: result.qtyVariances,
        rateVariances: result.rateVariances,
        summary: result.summary,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx as EnqueueTx, {
        topic: EVENTS.matchCompleted, eventType: EVENTS.matchCompleted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, poId: p.poId, grnId: p.grnId, invoiceId: p.invoiceId, status: result.status, paymentBlocked: result.paymentBlocked },
      });
      await audit(tx as EnqueueTx, msg, "create", p.id);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE.threeWayMatch);
  });

  q.subscribe(COMMANDS.threeWayMatchResolve, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number; resolutionNote: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const [updated] = await tx
        .update(threeWayMatches)
        .set({
          status: "resolved",
          paymentBlocked: 0,
          resolvedBy: msg.actorId,
          resolvedAt: new Date(),
          resolutionNote: p.resolutionNote,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
          version: p.version + 1,
        })
        .where(
          and(
            eq(threeWayMatches.id, p.id),
            eq(threeWayMatches.tenantId, msg.tenantId),
            eq(threeWayMatches.version, p.version),
          ),
        )
        .returning();

      if (!updated) return;

      await enqueue(tx as EnqueueTx, {
        topic: EVENTS.matchResolved, eventType: EVENTS.matchResolved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, poId: updated.poId, grnId: updated.grnId, invoiceId: updated.invoiceId, resolvedBy: msg.actorId, resolutionNote: p.resolutionNote },
      });
      await audit(tx as EnqueueTx, msg, "resolve", p.id);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE.threeWayMatch);
  });
}

async function audit(tx: EnqueueTx, msg: CommandEnvelope, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: INTEGRATION.audit, eventType: INTEGRATION.audit,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "inventory", action, resourceType: "three_way_match", resourceId, outcome: "success" },
  });
}
