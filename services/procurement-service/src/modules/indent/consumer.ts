import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertTransitionAllowed } from "./domain.js";
import type { IndentItemInsert } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerIndentConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.indentCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; indentNo: string; department: string; purpose: string;
      sanctionRef?: string; requiredBy?: string;
      items: Array<{ itemCode: string; description: string; quantity: number; unit: string; unitPriceMinor: number }>;
    };
    const totalMinor = p.items.reduce((s, i) => s + BigInt(i.unitPriceMinor) * BigInt(i.quantity), 0n);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertIndent(tx, {
        id: p.id, tenantId: p.tenantId, indentNo: p.indentNo,
        department: p.department, purpose: p.purpose, totalMinor,
        currency: "INR", status: "pending",
        sanctionRef: p.sanctionRef ?? null, requiredBy: p.requiredBy ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      const itemRows: IndentItemInsert[] = p.items.map((i) => ({
        id: randomUUID(), indentId: p.id, tenantId: p.tenantId,
        itemCode: i.itemCode, description: i.description,
        quantity: i.quantity, unit: i.unit,
        unitPriceMinor: BigInt(i.unitPriceMinor), currency: "INR",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      }));
      await repo.insertIndentItems(tx, itemRows);
      await audit(tx, msg, "create", "indent", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "indent", p.id));
  });

  queue.subscribe(COMMANDS.indentApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const indent = await repo.findIndentByIdTx(tx, p.id);
      if (!indent) throw new Error(`indent ${p.id} not found`);
      assertTransitionAllowed(indent.status ?? "draft", "approved");
      await repo.updateIndent(tx, p.id, { status: "approved", updatedBy: msg.actorId, version: (indent.version ?? 1) + 1 });
      await enqueue(tx, {
        topic: EVENTS.indentApproved, eventType: EVENTS.indentApproved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { indentId: p.id, tenantId: p.tenantId },
      });
      await audit(tx, msg, "approve", "indent", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "indent", p.id));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "procurement", action, resourceType, resourceId, outcome: "success" },
  });
}
