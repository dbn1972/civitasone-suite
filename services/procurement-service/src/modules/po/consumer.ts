import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertBudgetSufficient, assertCanDispatch } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const FINANCE_URL = process.env.FINANCE_SERVICE_URL ?? "http://finance-service:3007";

async function checkSanctionAvailable(sanctionRef: string, required: bigint): Promise<void> {
  const sanctionId = sanctionRef.replace(/^.*:/, "");
  const res = await fetch(`${FINANCE_URL}/v1/finance/sanctions/${sanctionId}/available`, {
    headers: { "x-internal": "1" },
  });
  if (!res.ok) throw new Error(`finance-service sanctions check failed: ${res.status}`);
  const data = await res.json() as { available: string };
  assertBudgetSufficient(BigInt(data.available), required);
}

export function registerPoConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.poCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; poNo: string; vendorId: string; indentRef: string;
      sanctionRef?: string; rateContractRef?: string; deliveryDate?: string;
      items: Array<{ itemCode: string; description: string; quantity: number; unit: string; unitPriceMinor: number }>;
    };
    const totalMinor = p.items.reduce((s, i) => s + BigInt(i.unitPriceMinor) * BigInt(i.quantity), 0n);

    // Budget check: call finance-service BEFORE any DB write (no DB call inside txn)
    if (p.sanctionRef) {
      try {
        await checkSanctionAvailable(p.sanctionRef, totalMinor);
      } catch (err) {
        // Budget exceeded or finance-service unavailable → emit budget_exceeded, do not write PO
        await db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          await enqueue(tx, {
            topic: EVENTS.poBudgetExceeded, eventType: EVENTS.poBudgetExceeded,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: { poId: p.id, poNo: p.poNo, sanctionRef: p.sanctionRef, totalMinor: totalMinor.toString(), reason: String(err) },
          });
        });
        return;
      }
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPo(tx, {
        id: p.id, tenantId: p.tenantId, poNo: p.poNo, vendorId: p.vendorId,
        indentRef: p.indentRef, sanctionRef: p.sanctionRef ?? null,
        rateContractRef: p.rateContractRef ?? null, gemOrderNo: null,
        totalMinor, currency: "INR", status: "approved",
        deliveryDate: p.deliveryDate ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      const itemRows = p.items.map((i) => ({
        id: randomUUID(), poId: p.id, tenantId: p.tenantId,
        itemCode: i.itemCode, description: i.description, quantity: i.quantity,
        unit: i.unit, unitPriceMinor: BigInt(i.unitPriceMinor), currency: "INR" as const,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      }));
      await repo.insertPoItems(tx, itemRows);
      await enqueue(tx, {
        topic: EVENTS.poApproved, eventType: EVENTS.poApproved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { poId: p.id, poNo: p.poNo, vendorId: p.vendorId, totalMinor: totalMinor.toString() },
      });
      await audit(tx, msg, "create", "po", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "po", p.id));
  });

  queue.subscribe(COMMANDS.poDispatch, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const po = await repo.findPoByIdTx(tx, p.id);
      if (!po) throw new Error(`po ${p.id} not found`);
      assertCanDispatch(po.status ?? "draft");
      await repo.updatePo(tx, p.id, { status: "dispatched", updatedBy: msg.actorId, version: (po.version ?? 1) + 1 });
      await audit(tx, msg, "dispatch", "po", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "po", p.id));
  });

  queue.subscribe(COMMANDS.gemOrderCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; poNo: string; vendorId: string; indentRef: string;
      sanctionRef?: string; gemOrderNo: string; deliveryDate?: string;
      items: Array<{ itemCode: string; description: string; quantity: number; unit: string; unitPriceMinor: number }>;
    };
    const totalMinor = p.items.reduce((s, i) => s + BigInt(i.unitPriceMinor) * BigInt(i.quantity), 0n);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPo(tx, {
        id: p.id, tenantId: p.tenantId, poNo: p.poNo, vendorId: p.vendorId,
        indentRef: p.indentRef, sanctionRef: p.sanctionRef ?? null, rateContractRef: null,
        gemOrderNo: p.gemOrderNo, totalMinor, currency: "INR", status: "gem_placed",
        deliveryDate: p.deliveryDate ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      const itemRows = p.items.map((i) => ({
        id: randomUUID(), poId: p.id, tenantId: p.tenantId,
        itemCode: i.itemCode, description: i.description, quantity: i.quantity,
        unit: i.unit, unitPriceMinor: BigInt(i.unitPriceMinor), currency: "INR" as const,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      }));
      await repo.insertPoItems(tx, itemRows);
      await audit(tx, msg, "gem_order", "po", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "po", p.id));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "procurement", action, resourceType, resourceId, outcome: "success" },
  });
}
