import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * eOffice file-noting decisions for a purchase order are RECORDED only.
 *
 * D4c #19 (GAP-PROCUREMENT-ORDERS-DETAIL-01, owner decision 2026-10-27): the
 * workflow inbox (procurement.po.approve - maker-checker, role check, audit) is
 * the ONLY approval path for a PO. An eOffice file-noting remains optional and
 * never gates release, so when estab-service reports the file's decision
 * (`procurement.po.file_decided`) this consumer writes it to the audit trail and
 * changes nothing else: no status change, no approved / cancelled event. (It used
 * to approve or cancel the PO itself, which made eOffice a second, competing
 * release path.)
 */
export function registerEOfficeDecisionConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.poFileDecided, async (msg) => {
    const parsed = parseDecisionCallback(msg.payload);
    if (!parsed.ok) {
      // Malformed callback - drop (the envelope/audit trail records the miss).
      return;
    }
    const cb = parsed.value;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const po = await repo.findPoByIdTx(tx, cb.refId, msg.tenantId);
      if (!po || po.tenantId !== msg.tenantId) return; // not ours / unknown

      await audit(tx, msg, "eoffice_decision_recorded", cb.refId, {
        decision: cb.decision, fileNo: cb.fileNo, decidedBy: cb.decidedBy, dscHash: cb.dscHash ?? null,
        note: "recorded only; the PO is approved or rejected in the workflow inbox",
      });
    });
  });
}

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "procurement", action, resourceType: "po", resourceId, outcome: "success", metadata },
  });
}
