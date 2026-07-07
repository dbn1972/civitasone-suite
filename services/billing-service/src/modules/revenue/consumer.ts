import { eq, and, sql } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { revenueLedger, revenueAccruals } from "./schema.js";
import { dailyAccruals, computeDeferredBalance } from "./domain.js";
import { COMMANDS } from "../../topics.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerRevenueConsumers(q: Queue): void {
  q.subscribe(COMMANDS.revenueLedgerCreate, async (msg) => {
    await db.transaction(async (tx) => {
      await markProcessed(tx, msg.messageId);

      const payload = msg.payload as {
        id: string;
        tenantId: string;
        subscriptionId: string;
        totalAmountPaise: string;
        servicePeriodStart: string;
        servicePeriodEnd: string;
        totalDays: number;
      };

      const totalPaise = BigInt(payload.totalAmountPaise);

      await tx.insert(revenueLedger).values({
        id: payload.id,
        tenantId: payload.tenantId,
        subscriptionId: payload.subscriptionId,
        totalAmountPaise: totalPaise,
        servicePeriodStart: payload.servicePeriodStart,
        servicePeriodEnd: payload.servicePeriodEnd,
        totalDays: payload.totalDays,
        recognizedPaise: 0n,
        deferredPaise: totalPaise,
        status: "active",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: payload.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "billing",
          entity: "revenue_ledger",
          entityId: payload.id,
          action: "revenue_ledger_created",
        },
      });
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "revenue-ledger", (msg.payload as { id: string }).id));
  });

  q.subscribe(COMMANDS.revenueAccrualProcess, async (msg) => {
    await db.transaction(async (tx) => {
      await markProcessed(tx, msg.messageId);

      const payload = msg.payload as {
        id: string;
        ledgerId: string;
        accrualDate: string;
        tenantId: string;
      };

      // Fetch the ledger row (within transaction for consistency)
      const [ledger] = await tx
        .select()
        .from(revenueLedger)
        .where(and(eq(revenueLedger.id, payload.ledgerId), eq(revenueLedger.tenantId, payload.tenantId)));

      if (!ledger) return;
      if (ledger.status !== "active") return;

      // Compute the daily amount for this specific day
      const allAccruals = dailyAccruals(ledger.totalAmountPaise, ledger.totalDays);
      const dayIndex = computeDayIndex(ledger.servicePeriodStart, payload.accrualDate);

      if (dayIndex < 0 || dayIndex >= allAccruals.length) return;

      const accrualAmount = allAccruals[dayIndex]!;

      // Insert accrual entry
      await tx.insert(revenueAccruals).values({
        id: payload.id,
        tenantId: payload.tenantId,
        ledgerId: payload.ledgerId,
        accrualDate: payload.accrualDate,
        amountPaise: accrualAmount,
      });

      // Update ledger balances (recognized up, deferred down)
      const newRecognized = ledger.recognizedPaise + accrualAmount;
      const newDeferred = computeDeferredBalance(ledger.totalAmountPaise, newRecognized);

      const newStatus = newRecognized >= ledger.totalAmountPaise ? "completed" : "active";

      await tx
        .update(revenueLedger)
        .set({
          recognizedPaise: newRecognized,
          deferredPaise: newDeferred,
          status: newStatus,
          updatedAt: new Date(),
          updatedBy: msg.actorId,
          version: sql`${revenueLedger.version} + 1`,
        })
        .where(and(eq(revenueLedger.id, payload.ledgerId), eq(revenueLedger.version, ledger.version)));

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: payload.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "billing",
          entity: "revenue_accrual",
          entityId: payload.id,
          action: "revenue_accrual_processed",
          ledgerId: payload.ledgerId,
          accrualDate: payload.accrualDate,
          amountPaise: accrualAmount.toString(),
        },
      });
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "revenue-ledger", (msg.payload as { ledgerId: string }).ledgerId));
  });
}

/**
 * Computes the 0-based day index from the start of the service period.
 */
function computeDayIndex(periodStart: string, accrualDate: string): number {
  const startMs = new Date(periodStart).getTime();
  const dateMs = new Date(accrualDate).getTime();
  return Math.floor((dateMs - startMs) / (24 * 60 * 60 * 1000));
}
