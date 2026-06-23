import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import * as grnRepo from "../grn/repo.js";
import { assertAdvancePositive } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

async function validateThreeWayMatch(tenantId: string, poRef: string): Promise<void> {
  const grnCount = await grnRepo.countAcceptedGrnsByPoRef(tenantId, poRef);
  if (grnCount === 0) {
    throw new Error("THREE_WAY_MATCH_REQUIRED: Payment blocked — no GRN received for this PO. GFR requires goods receipt before payment.");
  }
  const hasInvoice = await grnRepo.hasMatchedThreeWayWithInvoice(tenantId, poRef);
  if (!hasInvoice) {
    throw new Error("THREE_WAY_MATCH_REQUIRED: Payment blocked — no vendor invoice / three-way match found for this PO.");
  }
}

export function registerPaymentsConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.advanceCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; poRef: string; vendorId: string;
      amountMinor: number; advanceType: string; currency?: string;
    };
    assertAdvancePositive(BigInt(p.amountMinor));
    await validateThreeWayMatch(p.tenantId, p.poRef);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertAdvance(tx, {
        id: p.id, tenantId: p.tenantId, poRef: p.poRef, vendorId: p.vendorId,
        amountMinor: BigInt(p.amountMinor), currency: p.currency ?? "INR",
        advanceType: p.advanceType, status: "pending", recoveryMinor: 0n,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "advance", p.id);
    });
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "procurement", action, resourceType, resourceId, outcome: "success" },
  });
}
