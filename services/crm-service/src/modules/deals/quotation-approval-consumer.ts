/**
 * Quotation-approval consumer (QP-004) — applies threshold upserts and approval
 * request/decision writes.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-quotation-approval-consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId } as Parameters<typeof emitWithAudit>[1];
}

export function registerQuotationApprovalConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.upsertApprovalThreshold, async (msg) => {
    const p = msg.payload as { tenantId: string; approvalType: string; maxDiscountBps: number; requiresRole: string; enabled: boolean };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.approval_thresholds (tenant_id, approval_type, max_discount_bps, requires_role, enabled, created_by, updated_by)
          VALUES (${p.tenantId}, ${p.approvalType}, ${p.maxDiscountBps}, ${p.requiresRole}, ${p.enabled}, ${msg.actorId}, ${msg.actorId})
          ON CONFLICT (tenant_id, approval_type) DO UPDATE
            SET max_discount_bps = EXCLUDED.max_discount_bps, requires_role = EXCLUDED.requires_role,
                enabled = EXCLUDED.enabled, updated_at = now(), updated_by = EXCLUDED.updated_by, version = crm.approval_thresholds.version + 1
        `);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.approvalThresholdUpserted, action: "upsert", resourceType: "approval_threshold",
          resourceId: `${p.tenantId}:${p.approvalType}`,
          payload: { approvalType: p.approvalType, maxDiscountBps: p.maxDiscountBps },
        });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "upsertApprovalThreshold failed"); throw err; }
  });

  queue.subscribe(COMMANDS.requestQuotationApproval, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; quotationId: string; approvalType: string; status: string;
      thresholdBreached: unknown; reason: string | null; requestedBy: string;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.quotation_approvals
            (id, tenant_id, quotation_id, approval_type, status, threshold_breached, reason, requested_by, approver, decided_at)
          VALUES (${p.id}, ${p.tenantId}, ${p.quotationId}, ${p.approvalType}, ${p.status},
                  ${JSON.stringify(p.thresholdBreached)}::jsonb, ${p.reason}, ${p.requestedBy},
                  ${p.status === "approved" ? msg.actorId : null},
                  ${p.status === "approved" ? sql`now()` : sql`NULL`})
          ON CONFLICT (id) DO NOTHING
        `);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.quotationApprovalRequested, action: "request_approval", resourceType: "quotation_approval",
          resourceId: p.id,
          payload: { approvalId: p.id, quotationId: p.quotationId, approvalType: p.approvalType, status: p.status },
        });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "requestQuotationApproval failed"); throw err; }
  });

  queue.subscribe(COMMANDS.decideQuotationApproval, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; decision: "approve" | "reject"; reason: string | null; approver: string; expectedVersion: number };
    const newStatus = p.decision === "approve" ? "approved" : "rejected";
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const updated = await tx.execute(sql`
          UPDATE crm.quotation_approvals
          SET status = ${newStatus}, approver = ${p.approver}, decided_at = now(),
              reason = COALESCE(${p.reason}, reason), updated_at = now(), version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND status = 'pending' AND version = ${p.expectedVersion}
          RETURNING id
        `) as unknown as Array<{ id: string }>;
        if (updated.length === 0) return;
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.quotationApprovalDecided, action: "decide_approval", resourceType: "quotation_approval",
          resourceId: p.id,
          payload: { approvalId: p.id, status: newStatus },
        });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "decideQuotationApproval failed"); throw err; }
  });
}
