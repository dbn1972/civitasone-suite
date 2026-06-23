import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMED } from "../../topics.js";
import * as repo from "./repo.js";
import * as receiptRepo from "../receipt/repo.js";
import { weightedAvgRate, assertStockNotNegative, voucherTypeForEntry } from "./domain.js";
import type { EntryItemInsert } from "./schema.js";
import type { LedgerInsert } from "../ledger/schema.js";

const AUDIT_TOPIC = "audit.event.record";
const GL_TOPIC    = "finance.gl.post";

export function registerEntryConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.entryCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string;
      entryType: "receipt" | "issue" | "transfer" | "adjustment";
      refDoc?: string; refNo?: string; postingDate: string;
      fromWarehouseId?: string; toWarehouseId?: string; notes?: string;
      items: Array<{ itemId: string; qty: number; rateMinor: number; currency?: string }>;
    };

    const warehouseId = p.toWarehouseId ?? p.fromWarehouseId ?? "00000000-0000-4000-8000-000000000000";

    // Validate stock for issue/transfer_out — use FIFO lock inside transaction
    const needsStockCheck = p.entryType === "issue" || p.entryType === "transfer";

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      if (needsStockCheck) {
        const srcWarehouse = p.fromWarehouseId ?? warehouseId;
        for (const item of p.items) {
          const available = await receiptRepo.lockAvailableQty(tx, p.tenantId, item.itemId, srcWarehouse);
          if (available < item.qty) {
            throw new Error(`INSUFFICIENT_STOCK: Only ${available} units available, ${item.qty} requested.`);
          }
        }
      }

      await repo.insertEntry(tx, {
        id: p.id, tenantId: p.tenantId, entryType: p.entryType,
        refDoc: p.refDoc ?? null, refNo: p.refNo ?? null,
        postingDate: p.postingDate,
        fromWarehouseId: p.fromWarehouseId ?? null, toWarehouseId: p.toWarehouseId ?? null,
        notes: p.notes ?? null, status: "posted",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });

      const entryItemRows: EntryItemInsert[] = p.items.map((item) => ({
        id: randomUUID(), tenantId: p.tenantId, entryId: p.id,
        itemId: item.itemId, qty: item.qty,
        rateMinor: BigInt(item.rateMinor), amountMinor: BigInt(item.qty) * BigInt(item.rateMinor),
        currency: item.currency ?? "INR",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      }));
      await repo.insertEntryItems(tx, entryItemRows);

      for (const item of p.items) {
        const isReceipt   = p.entryType === "receipt";
        const isIssue     = p.entryType === "issue";
        const isTransfer  = p.entryType === "transfer";
        const isAdjustment= p.entryType === "adjustment";

        // Update valuation + ledger for destination warehouse
        if (isReceipt || isAdjustment || (isTransfer && p.toWarehouseId)) {
          const dest = isTransfer ? (p.toWarehouseId ?? warehouseId) : warehouseId;
          const current = await repo.getValuationRate(p.tenantId, item.itemId, dest);
          const newRate = isReceipt
            ? weightedAvgRate(
                { qty: current.qty, rateMinor: current.rateMinor },
                item.qty, BigInt(item.rateMinor)
              )
            : (isAdjustment ? BigInt(item.rateMinor) : current.rateMinor);
          const newQty = current.qty + item.qty;
          await repo.upsertValuationRate(tx, p.tenantId, item.itemId, dest, newQty, newRate, item.currency ?? "INR");
          const ledgerRow: LedgerInsert = {
            id: randomUUID(), tenantId: p.tenantId, itemId: item.itemId,
            warehouseId: dest, entryId: p.id,
            voucherType: voucherTypeForEntry(p.entryType, "to"),
            qtyIn: item.qty, qtyOut: 0, balanceQty: newQty,
            rateMinor: newRate, currency: item.currency ?? "INR",
            postingDate: p.postingDate, createdBy: msg.actorId,
          };
          await repo.appendLedger(tx, ledgerRow);
        }

        // Decrement source warehouse for issue/transfer (FIFO batch consumption)
        if (isIssue || (isTransfer && p.fromWarehouseId)) {
          const src = p.fromWarehouseId ?? warehouseId;
          await receiptRepo.consumeFIFO(tx, p.tenantId, item.itemId, src, item.qty);
          const current = await repo.getValuationRate(p.tenantId, item.itemId, src);
          const newQty = current.qty - item.qty;
          await repo.upsertValuationRate(tx, p.tenantId, item.itemId, src, newQty, current.rateMinor, item.currency ?? "INR");
          const ledgerRow: LedgerInsert = {
            id: randomUUID(), tenantId: p.tenantId, itemId: item.itemId,
            warehouseId: src, entryId: p.id,
            voucherType: voucherTypeForEntry(p.entryType, "from"),
            qtyIn: 0, qtyOut: item.qty, balanceQty: newQty,
            rateMinor: current.rateMinor, currency: item.currency ?? "INR",
            postingDate: p.postingDate, createdBy: msg.actorId,
          };
          await repo.appendLedger(tx, ledgerRow);
        }

        // Record FIFO receipt batch on inbound stock
        if (isReceipt || (isTransfer && p.toWarehouseId)) {
          const dest = isTransfer ? (p.toWarehouseId ?? warehouseId) : warehouseId;
          await receiptRepo.insertReceipt(tx, {
            id: randomUUID(), tenantId: p.tenantId, itemId: item.itemId,
            warehouseId: dest, entryId: p.id,
            quantity: item.qty, remainingQty: item.qty,
            unitCostMinor: BigInt(item.rateMinor), currency: item.currency ?? "INR",
          });
        }
      }

      // Emit GL event for stock account
      const totalAmount = p.items.reduce((sum, i) => sum + BigInt(i.qty) * BigInt(i.rateMinor), 0n);
      await enqueue(tx, {
        topic: GL_TOPIC, eventType: GL_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { entryId: p.id, entryType: p.entryType, totalMinor: totalAmount.toString(), type: "stock_entry" },
      });
      await enqueue(tx, {
        topic: EVENTS.entryCreated, eventType: EVENTS.entryCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { entryId: p.id, entryType: p.entryType },
      });
      await audit(tx, msg, "create", "stock_entry", p.id);
    });

    await cache.invalidateResource(msg.tenantId, "valuation");
  });

  // GRN accepted → stock receipt for consumable items
  queue.subscribe(CONSUMED.grnAccepted, async (msg) => {
    const p = msg.payload as {
      grnId: string; poRef: string; vendorId: string;
      items?: Array<{ itemCode: string; itemName: string; acceptedQty: number; rateMinor: number; currency?: string; itemType?: string; itemId?: string }>;
      warehouseId?: string;
    };
    const consumableItems = (p.items ?? []).filter((i) => i.itemType !== "fixed_asset" && i.itemId);
    if (consumableItems.length === 0) return;

    const entryId = randomUUID();
    const warehouseId = p.warehouseId ?? "00000000-0000-4000-8000-000000000000";

    for (const item of consumableItems) {
      if (!item.itemId) continue;
      const current = await repo.getValuationRate(msg.tenantId, item.itemId, warehouseId);
      const newRate = weightedAvgRate(
        { qty: current.qty, rateMinor: current.rateMinor },
        item.acceptedQty, BigInt(item.rateMinor)
      );
      const newQty = current.qty + item.acceptedQty;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, `${msg.messageId}:${item.itemCode}`))) return;
        await repo.upsertValuationRate(tx, msg.tenantId, item.itemId!, warehouseId, newQty, newRate, item.currency ?? "INR");
        await repo.appendLedger(tx, {
          id: randomUUID(), tenantId: msg.tenantId,
          itemId: item.itemId!, warehouseId, entryId,
          voucherType: "receipt",
          qtyIn: item.acceptedQty, qtyOut: 0, balanceQty: newQty,
          rateMinor: newRate, currency: item.currency ?? "INR",
          postingDate: new Date().toISOString().slice(0, 10),
          createdBy: msg.actorId,
        });
        await receiptRepo.insertReceipt(tx, {
          id: randomUUID(), tenantId: msg.tenantId, itemId: item.itemId!,
          warehouseId, entryId,
          quantity: item.acceptedQty, remainingQty: item.acceptedQty,
          unitCostMinor: BigInt(item.rateMinor), currency: item.currency ?? "INR",
        });
      });
    }
  });

  // Physical verification creates adjustment entries
  queue.subscribe(COMMANDS.physicalCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; warehouseId: string; postingDate: string;
      items: Array<{ itemId: string; countedQty: number }>;
      notes?: string;
    };
    for (const item of p.items) {
      const current = await repo.getValuationRate(p.tenantId, item.itemId, p.warehouseId);
      const diff = item.countedQty - current.qty;
      if (diff === 0) continue;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, `${msg.messageId}:${item.itemId}`))) return;
        await repo.upsertValuationRate(tx, p.tenantId, item.itemId, p.warehouseId, item.countedQty, current.rateMinor, "INR");
        await repo.appendLedger(tx, {
          id: randomUUID(), tenantId: p.tenantId, itemId: item.itemId,
          warehouseId: p.warehouseId, entryId: p.id, voucherType: "adjustment",
          qtyIn: Math.max(0, diff), qtyOut: Math.max(0, -diff),
          balanceQty: item.countedQty, rateMinor: current.rateMinor,
          currency: "INR", postingDate: p.postingDate, createdBy: msg.actorId,
        });
      });
    }
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "stock", action, resourceType, resourceId, outcome: "success" },
  });
}
