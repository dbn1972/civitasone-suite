import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertTransitionAllowed, assertDistinctMakerChecker } from "./domain.js";
import { allocateDocNo } from "../../shared/numbering.js";
import type { IndentItemInsert } from "./schema.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";
const WORKFLOW_CREATE = "workflow.instance.create";
const INDENT_WORKFLOW_NAME = "Procurement Indent Approval";
const TENDER_THRESHOLD_MINOR = 2500000n; // Rs 25,000 in paise (GFR Rule 145)

export function registerIndentConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.indentCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; indentNo: string; department: string; purpose: string;
      sanctionRef?: string; requiredBy?: string;
      items: Array<{ itemCode: string; description: string; quantity: number; unit: string; unitPriceMinor: number }>;
    };
    const totalMinor = p.items.reduce((s, i) => s + BigInt(i.unitPriceMinor) * BigInt(i.quantity), 0n);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Gapless server-generated number (#12) — ignore any client-supplied indentNo.
      const indentNo = await allocateDocNo(tx, p.tenantId, "indent");
      await repo.insertIndent(tx, {
        id: p.id, tenantId: p.tenantId, indentNo,
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
      const wfId = randomUUID();
      await enqueue(tx, {
        topic: WORKFLOW_CREATE, eventType: WORKFLOW_CREATE,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: wfId,
          tenantId: msg.tenantId,
          name: `${INDENT_WORKFLOW_NAME} — ${indentNo}`,
          status: "active",
          definitionCode: "procurement_indent_approval",
          initialTaskName: "Procurement Officer Approval",
          version: 1,
          refType: "procurement_indent",
          refId: p.id,
        },
      });
      await audit(tx, msg, "create", "indent", p.id);

      // GFR Rule 145: indents above Rs 25,000 require competitive tender
      if (totalMinor > TENDER_THRESHOLD_MINOR) {
        await repo.updateIndent(tx, p.id, { status: "tender_required", updatedBy: msg.actorId });
        await enqueue(tx, {
          topic: EVENTS.tenderRequired, eventType: EVENTS.tenderRequired,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            indentId: p.id,
            tenantId: msg.tenantId,
            estimatedValueMinor: totalMinor.toString(),
            gfrRule: "Rule145",
          },
        });
      }
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "indent", p.id));
  });

  queue.subscribe(COMMANDS.indentApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const indent = await repo.findIndentByIdTx(tx, p.id);
      if (!indent) throw new Error(`indent ${p.id} not found`);
      // SoD defense-in-depth: approver (msg.actorId) must differ from creator.
      assertDistinctMakerChecker(indent.createdBy, msg.actorId);
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

  queue.subscribe(COMMANDS.indentReject, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const indent = await repo.findIndentByIdTx(tx, p.id);
      if (!indent) throw new Error(`indent ${p.id} not found`);
      assertTransitionAllowed(indent.status ?? "draft", "rejected");
      await repo.updateIndent(tx, p.id, { status: "rejected", updatedBy: msg.actorId, version: (indent.version ?? 1) + 1 });
      await enqueue(tx, {
        topic: EVENTS.indentRejected, eventType: EVENTS.indentRejected,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { indentId: p.id, tenantId: p.tenantId, reason: p.reason },
      });
      await audit(tx, msg, "reject", "indent", p.id);
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
