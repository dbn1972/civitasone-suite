/**
 * GAP-PAYROLL-PAY-GROUPS-03: idempotent consumers for pay-group membership.
 * One transaction each (markProcessed first), tenant-scoped, and an
 * `audit.event.record` outbox event in the same transaction. A bulk assignment
 * is ONE transaction and ONE audit event for the whole batch.
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { applyAssignment, endAssignment, type AssignOutcome } from "./pay-group-repo.js";

const AUDIT = "audit.event.record";
const log = pino({ name: "payroll-pay-group-membership" });

type Msg = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: unknown };
type Tx = Parameters<typeof enqueue>[0];

async function auditEvent(
  tx: Tx, msg: Msg, action: string, resourceType: string, resourceId: string,
  details: Record<string, unknown>, outcome = "success",
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { ...details, service: "payroll", action, resourceType, resourceId, outcome },
  });
}

export function registerPayGroupConsumers(queue: Pick<Queue, "subscribe">): void {
  queue.subscribe(COMMANDS.payGroupMemberAssign, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as { tenantId: string; payGroupId: string; employeeId: string; effectiveFrom: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const r = await applyAssignment(tx, {
        tenantId: p.tenantId, actorId: msg.actorId, employeeId: p.employeeId,
        payGroupId: p.payGroupId, effectiveFrom: p.effectiveFrom, reason: p.reason,
      });
      const ok = r.outcome === "assigned" || r.outcome === "moved";
      if (!ok) log.warn({ payGroupId: p.payGroupId, outcome: r.outcome }, "pay-group assignment was not applied (state moved since the request)");
      await auditEvent(tx, msg, r.outcome === "moved" ? "move" : "assign", "payroll_pay_group_member", p.payGroupId, {
        employeeId: p.employeeId, effectiveFrom: p.effectiveFrom, reason: p.reason,
        ...(r.outcome === "moved" ? { fromPayGroupId: r.fromPayGroupId } : {}),
        ...(r.outcome === "rejected" ? { code: r.code, message: r.message } : {}),
        ...(r.outcome === "unchanged" ? { code: r.code } : {}),
      }, ok ? "success" : "rejected");
    });
  });

  queue.subscribe(COMMANDS.payGroupMemberEnd, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as { tenantId: string; payGroupId: string; employeeId: string; endsOn: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const r = await endAssignment(tx, {
        tenantId: p.tenantId, actorId: msg.actorId, employeeId: p.employeeId,
        payGroupId: p.payGroupId, endsOn: p.endsOn, reason: p.reason,
      });
      if (r.outcome !== "ended") log.warn({ payGroupId: p.payGroupId, code: r.code }, "pay-group membership end was not applied");
      await auditEvent(tx, msg, "end", "payroll_pay_group_member", p.payGroupId, {
        employeeId: p.employeeId, endsOn: p.endsOn, reason: p.reason,
        ...(r.outcome === "rejected" ? { code: r.code, message: r.message } : {}),
      }, r.outcome === "ended" ? "success" : "rejected");
    });
  });

  queue.subscribe(COMMANDS.payGroupMemberBulkAssign, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as {
      tenantId: string; batchId: string; payGroupId: string; employeeIds: string[]; effectiveFrom: string; reason: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Fixed employee order => a consistent lock order across concurrent batches.
      const ids = [...new Set(p.employeeIds)].sort();
      const results: Array<{ employeeId: string; r: AssignOutcome }> = [];
      for (const employeeId of ids) {
        results.push({
          employeeId,
          r: await applyAssignment(tx, {
            tenantId: p.tenantId, actorId: msg.actorId, employeeId,
            payGroupId: p.payGroupId, effectiveFrom: p.effectiveFrom, reason: p.reason,
          }),
        });
      }
      const pick = (o: AssignOutcome["outcome"]) => results.filter((x) => x.r.outcome === o).map((x) => x.employeeId);
      const rejected = results.filter((x) => x.r.outcome === "rejected").map((x) => ({
        employeeId: x.employeeId, code: (x.r as { code: string }).code,
      }));
      await auditEvent(tx, msg, "bulk_assign", "payroll_pay_group_member", p.payGroupId, {
        batchId: p.batchId, effectiveFrom: p.effectiveFrom, reason: p.reason,
        requested: ids.length,
        assigned: pick("assigned"), moved: pick("moved"), unchanged: pick("unchanged"), rejected,
      });
    });
  });

  queue.subscribe(COMMANDS.payGroupSettingsSet, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as { tenantId: string; allowMidMonthEffective: boolean; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = Array.from(await tx.execute(sql`
        SELECT allow_mid_month_effective FROM payroll.pay_group_settings WHERE tenant_id = ${p.tenantId}::uuid FOR UPDATE
      `) as Iterable<{ allow_mid_month_effective: boolean }>);
      await tx.execute(sql`
        INSERT INTO payroll.pay_group_settings (tenant_id, allow_mid_month_effective, updated_by)
        VALUES (${p.tenantId}::uuid, ${p.allowMidMonthEffective}, ${msg.actorId}::uuid)
        ON CONFLICT (tenant_id) DO UPDATE
           SET allow_mid_month_effective = EXCLUDED.allow_mid_month_effective,
               updated_by = EXCLUDED.updated_by, updated_at = NOW()
      `);
      await auditEvent(tx, msg, "update", "payroll_pay_group_settings", p.tenantId, {
        reason: p.reason,
        oldValue: before[0] ? { allowMidMonthEffective: before[0].allow_mid_month_effective } : null,
        newValue: { allowMidMonthEffective: p.allowMidMonthEffective },
      });
    });
  });
}
