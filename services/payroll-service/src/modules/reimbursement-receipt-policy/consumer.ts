import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { receiptPolicyIssue } from "@civitasone/types";
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { parseStoredPolicy, receiptPolicySchema } from "./repo.js";

const log = pino({ name: "payroll-reimbursement-receipt-policy-consumer" });
const AUDIT = "audit.event.record";

/**
 * payroll.reimbursement_receipt_policy.update -> payroll_settings.reimbursement_receipt_policy
 * with a before/after audit event, in ONE transaction.
 */
export function registerReceiptPolicyConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.reimbursementReceiptPolicyUpdate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; policy: unknown; reason?: string | null };
    try {
      const parsed = receiptPolicySchema.safeParse(p.policy);
      // A malformed command can never succeed on retry: dead-letter it.
      if (!parsed.success || receiptPolicyIssue(parsed.data)) {
        throw new NonRetryableError("reimbursement receipt policy update rejected: invalid policy");
      }
      const next = parsed.data;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const prevRows = (await tx.execute(sql`
          SELECT reimbursement_receipt_policy FROM payroll.payroll_settings
           WHERE tenant_id = ${p.tenantId}::uuid FOR UPDATE
        `)) as unknown as Array<{ reimbursement_receipt_policy: unknown }>;
        const before = parseStoredPolicy(prevRows[0]?.reimbursement_receipt_policy ?? null);
        await tx.execute(sql`
          INSERT INTO payroll.payroll_settings (tenant_id, reimbursement_receipt_policy, created_at, updated_at)
          VALUES (${p.tenantId}::uuid, ${JSON.stringify(next)}::jsonb, NOW(), NOW())
          ON CONFLICT (tenant_id) DO UPDATE
            SET reimbursement_receipt_policy = EXCLUDED.reimbursement_receipt_policy, updated_at = NOW()
        `);
        await enqueue(tx, {
          topic: EVENTS.reimbursementReceiptPolicyUpdated, eventType: EVENTS.reimbursementReceiptPolicyUpdated,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { tenantId: p.tenantId },
        });
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            service: "payroll",
            action: "reimbursement_receipt_policy_updated",
            resourceType: "payroll_settings",
            resourceId: p.tenantId,
            outcome: "success",
            // before = null: the tenant was on the built-in default (medical / LTA / travel need a receipt).
            detail: { before, after: next, reason: p.reason ?? null },
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "reimbursementReceiptPolicyUpdate failed");
      throw err;
    }
  });
}
