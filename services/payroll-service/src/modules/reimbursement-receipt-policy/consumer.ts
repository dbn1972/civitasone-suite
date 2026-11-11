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
          SELECT reimbursement_receipt_policy, reimbursement_receipt_policy_version AS version FROM payroll.payroll_settings
           WHERE tenant_id = ${p.tenantId}::uuid FOR UPDATE
        `)) as unknown as Array<{ reimbursement_receipt_policy: unknown; version: number }>;
        const newVersion = (prevRows[0]?.version ?? 0) + 1;
        const entry = JSON.stringify([{ version: newVersion, policy: next, at: new Date().toISOString() }]);
        const before = parseStoredPolicy(prevRows[0]?.reimbursement_receipt_policy ?? null);
        await tx.execute(sql`
          INSERT INTO payroll.payroll_settings
            (tenant_id, reimbursement_receipt_policy, reimbursement_receipt_policy_version, reimbursement_receipt_policy_history, created_at, updated_at)
          VALUES (${p.tenantId}::uuid, ${JSON.stringify(next)}::jsonb, ${newVersion}, ${entry}::jsonb, NOW(), NOW())
          ON CONFLICT (tenant_id) DO UPDATE
            SET reimbursement_receipt_policy = EXCLUDED.reimbursement_receipt_policy,
                reimbursement_receipt_policy_version = EXCLUDED.reimbursement_receipt_policy_version,
                -- keep the last 50 versions
                reimbursement_receipt_policy_history = (
                  SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'version')::int), '[]'::jsonb) FROM (
                    SELECT e FROM jsonb_array_elements(payroll.payroll_settings.reimbursement_receipt_policy_history || EXCLUDED.reimbursement_receipt_policy_history) e
                     ORDER BY (e->>'version')::int DESC LIMIT 50) t),
                updated_at = NOW()
        `);
        await enqueue(tx, {
          topic: EVENTS.reimbursementReceiptPolicyUpdated, eventType: EVENTS.reimbursementReceiptPolicyUpdated,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { tenantId: p.tenantId, version: newVersion },
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
            detail: { before, after: next, reason: p.reason ?? null, version: newVersion },
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "reimbursementReceiptPolicyUpdate failed");
      throw err;
    }
  });
}
