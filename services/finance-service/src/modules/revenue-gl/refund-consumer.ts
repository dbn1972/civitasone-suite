/**
 * V4-G-09 -- citizen.refund.approved -> GL reversal of the original receipt posting.
 *
 * citizen-service emits this when a refund is approved (possibly partial). We post
 * Dr revenue head / Cr bank for the refunded amount so revenue is not left overstated. The money
 * movement itself (gateway / disbursement) is outside this consumer.
 */
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { captureError } from "@civitasone/observability";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import * as budgetRepo from "../budget/repo.js";
import { enqueueSpineJournal } from "../gl/spine.js";
import type { JournalLine } from "../gl/schema.js";

/** Owned by citizen-service (EVENTS.refundApproved). */
export const CITIZEN_REFUND_APPROVED = CONSUMED_EVENTS.citizenRefundApproved;

const BANK_CODE = process.env.FINANCE_BANK_CODE ?? "1100";
// Citizen fee income has its own INCOME head (4100). It defaulted to 4200, the gain/loss-on-disposal head, which the
// chart and the statements treat as an EXPENSE, so fees showed as negative expense (UAT b10 review of F91).
const DEFAULT_REVENUE_CODE = process.env.FINANCE_CITIZEN_REVENUE_CODE ?? "4100";
const AUDIT_TOPIC = "audit.event.record";

export function registerRefundGlConsumer(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.citizenRefundApproved, async (msg) => {
    const p = msg.payload as {
      id: string; paymentId: string; receiptNo?: string | null;
      amountMinor: string | number; hoaCode?: string | null; serviceKey?: string | null;
    };
    const amount = BigInt(typeof p.amountMinor === "string" ? p.amountMinor : String(p.amountMinor));
    if (amount <= 0n) return;
    const revenueCode = p.hoaCode?.trim() || DEFAULT_REVENUE_CODE;
    const today = new Date().toISOString().slice(0, 10);

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const heads = tx as Parameters<typeof budgetRepo.findHeadByCodeTx>[0];
        const bankHead = await budgetRepo.findHeadByCodeTx(heads, msg.tenantId, BANK_CODE);
        if (!bankHead) throw new Error(`INVALID_HEAD_CODE: bank head code '${BANK_CODE}' not found in Chart of Accounts`);
        const revenueHead = await budgetRepo.findHeadByCodeTx(heads, msg.tenantId, revenueCode);
        if (!revenueHead) throw new Error(`INVALID_HEAD_CODE: revenue head code '${revenueCode}' not found in Chart of Accounts`);

        const narration = p.receiptNo ? `Refund against receipt ${p.receiptNo}` : "Citizen fee refund";
        const lines: JournalLine[] = [
          { accountCode: revenueHead.id, debitMinor: amount, creditMinor: 0n, narration },
          { accountCode: bankHead.id, debitMinor: 0n, creditMinor: amount, narration },
        ];
        await enqueueSpineJournal(tx, {
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          sourceKey: `citizen_refund:${p.id}`,
          // gl.finance_journals_type_check has no refund-specific type; a reversal is a general journal.
          type: "journal",
          postingDate: today,
          lines,
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            service: "finance", action: "citizen_refund_gl_enqueue", resourceType: "refund", resourceId: p.id,
            outcome: "success", paymentId: p.paymentId,
          },
        });
      });
      await cache.invalidateResource(msg.tenantId, "journals");
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      if (reason.startsWith("INVALID_HEAD_CODE")) {
        // Refund already approved upstream: alert and dead-letter (not marked processed, so a DLQ replay
        // after the chart is fixed posts the reversal) rather than acking it silently.
        captureError(err, {
          service: "finance-service", alert: "GL_CITIZEN_REFUND_UNPOSTED", topic: CITIZEN_REFUND_APPROVED,
          code: "INVALID_HEAD_CODE", refundId: p.id, paymentId: p.paymentId, tenantId: msg.tenantId,
        });
        throw new NonRetryableError(reason);
      }
      throw err;
    }
  });
}
