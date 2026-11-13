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
      // The envelope is authoritative for the tenant; a payload naming another tenant is refused.
      if (p.tenantId !== msg.tenantId) throw new NonRetryableError("reimbursement receipt policy update rejected: tenant mismatch");
      const tenantId = msg.tenantId;
      const parsed = receiptPolicySchema.safeParse(p.policy);
      // A malformed command can never succeed on retry: dead-letter it.
      if (!parsed.success || receiptPolicyIssue(parsed.data)) {
        throw new NonRetryableError("reimbursement receipt policy update rejected: invalid policy");
      }
      const next = parsed.data;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // Make sure the settings row exists, then lock it: two concurrent first-ever saves serialise here
        // and the second sees version 1 (no duplicate version-1 history entry).
        await tx.execute(sql`
          INSERT INTO payroll.payroll_settings (tenant_id, created_at, updated_at)
          VALUES (${tenantId}::uuid, NOW(), NOW()) ON CONFLICT (tenant_id) DO NOTHING
        `);
        const prevRows = (await tx.execute(sql`
          SELECT reimbursement_receipt_policy, reimbursement_receipt_policy_version AS version FROM payroll.payroll_settings
           WHERE tenant_id = ${tenantId}::uuid FOR UPDATE
        `)) as unknown as Array<{ reimbursement_receipt_policy: unknown; version: number }>;
        const before = parseStoredPolicy(prevRows[0]?.reimbursement_receipt_policy ?? null);
        const newVersion = (prevRows[0]?.version ?? 0) + 1;
        const entry = JSON.stringify([{ version: newVersion, policy: next, at: new Date().toISOString() }]);
        await tx.execute(sql`
          UPDATE payroll.payroll_settings
             SET reimbursement_receipt_policy = ${JSON.stringify(next)}::jsonb,
                 reimbursement_receipt_policy_version = ${newVersion},
                 -- keep the last 50 versions
                 reimbursement_receipt_policy_history = (
                   SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'version')::int), '[]'::jsonb) FROM (
                     SELECT e FROM jsonb_array_elements(reimbursement_receipt_policy_history || ${entry}::jsonb) e
                      ORDER BY (e->>'version')::int DESC LIMIT 50) t),
                 updated_at = NOW()
           WHERE tenant_id = ${tenantId}::uuid
        `);
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            service: "payroll",
            action: "reimbursement_receipt_policy_updated",
            resourceType: "payroll_settings",
            resourceId: tenantId,
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
