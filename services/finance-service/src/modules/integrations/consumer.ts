import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { EVENTS, CONSUMED_EVENTS } from "../../topics.js";
import * as auditRepo from "../audit/repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerIntegrationConsumers(queue: Queue): void {
  /** grant-service → finance: process EFT disbursement and confirm to grant via payment.made */
  queue.subscribe(CONSUMED_EVENTS.eftInitiate, async (msg) => {
    const p = msg.payload as {
      disbursementId: string; installmentId: string; amountMinor: string;
      currency: string; pfmsTxnId: string; mode: string; beneficiaryBankRef?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: EVENTS.paymentMade, eventType: EVENTS.paymentMade,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          disbursementId: p.disbursementId,
          pfmsTxnId: p.pfmsTxnId,
          amountMinor: p.amountMinor,
          mode: p.mode,
          outcome: "success",
        },
      });
      await audit(tx, msg, "eft_grant_disbursement", "payment", p.disbursementId);
    });
  });

  /** audit-service → finance: flag recoverable amount in finance audit paras register */
  queue.subscribe(CONSUMED_EVENTS.auditParaPendingRecovery, async (msg) => {
    const p = msg.payload as {
      paraId: string; deptRef: string; amountInvolvedMinor: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await auditRepo.insertAuditPara(tx, {
        id: randomUUID(), tenantId: msg.tenantId,
        paraNo: `AUDIT-${p.paraId.slice(0, 8)}`,
        source: "internal", dept: p.deptRef,
        moneyValueMinor: BigInt(p.amountInvolvedMinor),
        currency: "INR", status: "pending_recovery",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "recovery_flag", "finance_audit_para", p.paraId);
    });
  });
}

async function audit(
  tx: Parameters<typeof markProcessed>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string, resourceType: string, resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
