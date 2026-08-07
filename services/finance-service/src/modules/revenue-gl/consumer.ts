/**
 * FN-14 — citizen fee receipt → GL journal (payment-confirmed → balanced posting).
 *
 * Consumes `citizen.receipt.issued` emitted by citizen-service/fee-payment when
 * a counter/offline receipt is recorded. Posts Dr Bank / Cr revenue head (HOA
 * from the pack/service definition, or FINANCE_CITIZEN_REVENUE_CODE fallback).
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS, EVENTS } from "../../topics.js";
import * as budgetRepo from "../budget/repo.js";
import { enqueueSpineJournal } from "../gl/spine.js";
import type { JournalLine } from "../gl/schema.js";

const BANK_CODE = process.env.FINANCE_BANK_CODE ?? "1100";
const DEFAULT_REVENUE_CODE = process.env.FINANCE_CITIZEN_REVENUE_CODE ?? "4200";
const AUDIT_TOPIC = "audit.event.record";

export function registerRevenueGlConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.citizenReceiptIssued, async (msg) => {
    const p = msg.payload as {
      id: string;
      applicationId: string;
      receiptNo: string;
      amountMinor: string | number;
      currency?: string;
      hoaCode?: string | null;
      serviceKey?: string | null;
    };

    const amount = BigInt(typeof p.amountMinor === "string" ? p.amountMinor : String(p.amountMinor));
    if (amount <= 0n) return;

    const revenueCode = (p.hoaCode?.trim() || DEFAULT_REVENUE_CODE);
    const today = new Date().toISOString().slice(0, 10);
    const journalSourceKey = `citizen_receipt:${p.id}`;

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const bankHead = await budgetRepo.findHeadByCodeTx(
          tx as Parameters<typeof budgetRepo.findHeadByCodeTx>[0], msg.tenantId, BANK_CODE,
        );
        if (!bankHead) {
          throw new Error(`INVALID_HEAD_CODE: bank head code '${BANK_CODE}' not found in Chart of Accounts`);
        }

        const revenueHead = await budgetRepo.findHeadByCodeTx(
          tx as Parameters<typeof budgetRepo.findHeadByCodeTx>[0], msg.tenantId, revenueCode,
        );
        if (!revenueHead) {
          throw new Error(`INVALID_HEAD_CODE: revenue head code '${revenueCode}' not found in Chart of Accounts`);
        }

        const lines: JournalLine[] = [
          { accountCode: bankHead.id, debitMinor: amount, creditMinor: 0n, narration: `Receipt ${p.receiptNo}` },
          { accountCode: revenueHead.id, debitMinor: 0n, creditMinor: amount, narration: p.serviceKey ? `Fee: ${p.serviceKey}` : "Citizen fee receipt" },
        ];

        await enqueueSpineJournal(tx, {
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          sourceKey: journalSourceKey,
          type: "citizen_receipt",
          postingDate: today,
          lines,
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "finance",
            action: "citizen_receipt_gl_enqueue",
            resourceType: "payment",
            resourceId: p.id,
            outcome: "success",
            receiptNo: p.receiptNo,
          },
        });
      });
      await cache.invalidateResource(msg.tenantId, "journals");
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      if (reason.startsWith("INVALID_HEAD_CODE")) {
        await db.transaction(async (tx) => {
          await enqueue(tx, {
            topic: EVENTS.glRejected,
            eventType: EVENTS.glRejected,
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: { paymentId: p.id, receiptNo: p.receiptNo, reason },
          });
        });
        return;
      }
      throw err;
    }
  });
}
