/**
 * GAP-PAYROLL-ARREARS-03: maker-checker approve / reject of a manual arrear,
 * and the per-tenant switch that makes approval gate payment.
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { audit } from "../payroll/consumer.js";
import type { ArrearDecision, ArrearPolicyBody } from "./api.js";

export function registerArrearApprovalConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.arrearDecide, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; decision: ArrearDecision; note?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Race-safe conditional UPDATE: only a still-pending arrear moves, and
      // (when the tenant requires approval) never by its own creator.
      const updated = (await tx.execute(sql`
        UPDATE payroll.payroll_arrears
           SET status = ${p.decision},
               decided_by = ${msg.actorId}::uuid,
               decided_at = NOW(),
               decision_note = ${p.note ?? null}
         WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid
           AND status = 'pending' AND run_id IS NULL
           AND (created_by <> ${msg.actorId}::uuid
                OR NOT COALESCE((SELECT arrears_approval_required FROM payroll.payroll_settings
                                  WHERE tenant_id = ${msg.tenantId}::uuid), true))
        RETURNING id, employee_id::text AS employee_id, difference_minor::text AS difference_minor
      `)) as unknown as Array<{ id: string; employee_id: string; difference_minor: string }>;
      if (updated.length === 0) {
        // Lost the race / self-approval / already decided or paid: audit the
        // refusal and move nothing. Not an error to retry, so no throw (a throw
        // would also roll the audit row back).
        await audit(tx, msg, "decide_refused", "payroll_arrear", p.id, { attempted: p.decision });
        return;
      }
      await enqueue(tx, {
        topic: EVENTS.arrearDecided, eventType: EVENTS.arrearDecided,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, employeeId: updated[0]!.employee_id, decision: p.decision },
      });
      await audit(tx, msg, p.decision === "approved" ? "approve" : "reject", "payroll_arrear", p.id, {
        decision: p.decision, note: p.note ?? null, differenceMinor: updated[0]!.difference_minor,
      });
    });
  });

  queue.subscribe(COMMANDS.arrearPolicySet, async (msg) => {
    const p = msg.payload as ArrearPolicyBody & { id: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const prev = (await tx.execute(sql`
        SELECT arrears_approval_required AS required FROM payroll.payroll_settings
         WHERE tenant_id = ${msg.tenantId}::uuid FOR UPDATE
      `)) as unknown as Array<{ required: boolean }>;
      await tx.execute(sql`
        INSERT INTO payroll.payroll_settings (tenant_id, arrears_approval_required, created_at, updated_at)
        VALUES (${msg.tenantId}::uuid, ${p.required}, NOW(), NOW())
        ON CONFLICT (tenant_id) DO UPDATE
          SET arrears_approval_required = EXCLUDED.arrears_approval_required, updated_at = NOW()
      `);
      await audit(tx, msg, "update", "payroll_arrear_policy", msg.tenantId, {
        before: { required: prev[0]?.required ?? true }, after: { required: p.required }, reason: p.reason,
      });
    });
  });
}
