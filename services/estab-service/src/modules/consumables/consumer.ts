/**
 * consumables consumer — handles estab.consumable.create and
 * estab.consumable.transaction. Follows this service's CQRS consumer
 * pattern: markProcessed idempotency check → single db.transaction() →
 * audit event via outbox → cache invalidation.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { applyTransaction, isReorderRequired, DomainError, type ConsumableTxnType } from "./domain.js";

const log = pino({ name: "consumables-consumer" });
const AUDIT_TOPIC = "audit.event.record";

export function registerConsumablesConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.consumableCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; name: string;
        category?: string; unit?: string; reorderLevel?: number;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertItem(tx, {
          id: p.id, tenantId: p.tenantId, name: p.name,
          category: p.category ?? "stationery",
          unit: p.unit ?? "piece",
          stockQty: "0",
          reorderLevel: p.reorderLevel != null ? p.reorderLevel.toFixed(2) : "0",
          status: "active",
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "create", "consumable_item", p.id);
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, "consumable_item", p.id));
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "consumableCreate failed");
    }
  });

  queue.subscribe(COMMANDS.consumableTransaction, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; itemId: string;
        txnType: ConsumableTxnType; qty: number; refDoc?: string; notes?: string;
      };
      let resultingBalance: number | undefined;
      let reorderTriggered = false;
      let reorderLevel = 0;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const item = await repo.getItemByIdTx(tx, p.tenantId, p.itemId);
        if (!item) {
          log.warn({ messageId: msg.messageId, itemId: p.itemId }, "consumableTransaction: item not found, skipping");
          return;
        }

        const currentBalance = Number(item.stockQty);
        reorderLevel = Number(item.reorderLevel);
        let nextBalance: number;
        try {
          nextBalance = applyTransaction(currentBalance, p.txnType, p.qty);
        } catch (err) {
          if (err instanceof DomainError) {
            log.warn({ messageId: msg.messageId, itemId: p.itemId, code: err.code }, err.message);
            await audit(tx, msg, "transaction_rejected", "consumable_item", p.itemId);
            return;
          }
          throw err;
        }

        const delta = nextBalance - currentBalance;
        resultingBalance = await repo.upsertBalance(p.tenantId, p.itemId, delta, tx);
        await repo.insertTransaction(tx, {
          id: p.id, tenantId: p.tenantId, itemId: p.itemId,
          txnType: p.txnType, qty: p.qty.toFixed(2),
          refDoc: p.refDoc ?? null, notes: p.notes ?? null,
          createdBy: msg.actorId,
        });
        await audit(tx, msg, "transaction", "consumable_transaction", p.id);

        reorderTriggered = isReorderRequired(resultingBalance, reorderLevel);
        if (reorderTriggered) {
          await enqueue(tx, {
            topic: EVENTS.consumableReorderRequired, eventType: EVENTS.consumableReorderRequired,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: { itemId: p.itemId, balance: resultingBalance, reorderLevel },
          });
        }
      });

      await cache.invalidate(cache.makeKey(msg.tenantId, "consumable_item", p.itemId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "consumableTransaction failed");
    }
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", module: "consumables", action, resourceType, resourceId, outcome: "success" },
  });
}
