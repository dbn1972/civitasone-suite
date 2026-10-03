/**
 * fin-payroll-03 gap batch: idempotent consumers (one transaction each, an
 * audit.event.record outbox event per decision). Every state transition is a
 * CONDITIONAL UPDATE so a racing second command, or a redelivery that slipped
 * past markProcessed, changes nothing and is not audited as a change.
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const AUDIT = "audit.event.record";
const log = pino({ name: "payroll-fin03" });

type Msg = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: unknown };
type Tx = Parameters<typeof enqueue>[0];

async function auditEvent(
  tx: Tx, msg: Msg, action: string, resourceType: string, resourceId: string,
  details: Record<string, unknown> = {}, outcome = "success",
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { ...details, service: "payroll", action, resourceType, resourceId, outcome },
  });
}

export function registerFin03Consumers(queue: Pick<Queue, "subscribe">): void {
  // ─── GAP-PAYROLL-DDOS-03: activate / deactivate a DDO ───────────────────
  queue.subscribe(COMMANDS.ddoSetActive, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as { tenantId: string; ddoCode: string; active: boolean; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Deactivation is refused (no row updated) while the DDO still has an
      // active pensioner or a run being computed -- re-checked HERE, inside
      // the same statement, so a pensioner added after the route's pre-check
      // cannot be stranded.
      const rows = (p.active
        ? await tx.execute(sql`
            UPDATE payroll.payroll_ddos
               SET is_active = TRUE, deactivated_at = NULL, deactivated_by = NULL, updated_at = NOW()
             WHERE tenant_id = ${p.tenantId}::uuid AND ddo_code = ${p.ddoCode} AND is_active = FALSE
         RETURNING ddo_code`)
        : await tx.execute(sql`
            UPDATE payroll.payroll_ddos d
               SET is_active = FALSE, deactivated_at = NOW(), deactivated_by = ${msg.actorId}::uuid, updated_at = NOW()
             WHERE d.tenant_id = ${p.tenantId}::uuid AND d.ddo_code = ${p.ddoCode} AND d.is_active = TRUE
               AND NOT EXISTS (SELECT 1 FROM payroll.payroll_pensioners x
                                WHERE x.tenant_id = d.tenant_id AND x.ddo_code = d.ddo_code AND x.status = 'active')
               AND NOT EXISTS (SELECT 1 FROM payroll.payroll_runs r
                                WHERE r.tenant_id = d.tenant_id AND r.ddo_code = d.ddo_code
                                  AND r.status IN ('draft', 'processing'))
         RETURNING ddo_code`)) as unknown as Array<{ ddo_code: string }>;
      if (rows.length === 0) {
        log.warn({ ddoCode: p.ddoCode, active: p.active }, "ddo set_active was a no-op (already in that state, or still in use)");
        return;
      }
      await auditEvent(tx, msg, p.active ? "activate" : "deactivate", "payroll_ddo", p.ddoCode, {
        reason: p.reason, newValue: { isActive: p.active },
      });
    });
  });

  // ─── GAP-PAYROLL-PAY-GROUPS-01/03 ────────────────────────────────────────
  queue.subscribe(COMMANDS.payGroupUpdate, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as {
      tenantId: string; id: string; name: string; frequency: string; payDayOfMonth: number; timezone: string;
      payWeekday: number | null; payLastDay: boolean; payWeekParity: number | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = (await tx.execute(sql`
        SELECT name, frequency, pay_day_of_month, timezone, pay_weekday, pay_last_day, pay_week_parity
          FROM payroll.pay_groups WHERE id = ${p.id}::uuid AND tenant_id = ${p.tenantId}::uuid FOR UPDATE
      `)) as unknown as Array<Record<string, unknown>>;
      if (before.length === 0) return;
      await tx.execute(sql`
        UPDATE payroll.pay_groups
           SET name = ${p.name}, frequency = ${p.frequency}, pay_day_of_month = ${p.payDayOfMonth},
               timezone = ${p.timezone}, pay_weekday = ${p.payWeekday}, pay_last_day = ${p.payLastDay},
               pay_week_parity = ${p.payWeekParity}, updated_by = ${msg.actorId}::uuid, updated_at = NOW()
         WHERE id = ${p.id}::uuid AND tenant_id = ${p.tenantId}::uuid
      `);
      await auditEvent(tx, msg, "update", "payroll_pay_group", p.id, {
        oldValue: before[0],
        newValue: {
          name: p.name, frequency: p.frequency, pay_day_of_month: p.payDayOfMonth, timezone: p.timezone,
          pay_weekday: p.payWeekday, pay_last_day: p.payLastDay, pay_week_parity: p.payWeekParity,
        },
      });
    });
  });

  queue.subscribe(COMMANDS.payGroupSetActive, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as { tenantId: string; id: string; active: boolean; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // 'archived' is the stored inactive state (pay_groups_status_check).
      const next = p.active ? "active" : "archived";
      const rows = (await tx.execute(sql`
        UPDATE payroll.pay_groups SET status = ${next}, updated_by = ${msg.actorId}::uuid, updated_at = NOW()
         WHERE id = ${p.id}::uuid AND tenant_id = ${p.tenantId}::uuid AND status <> ${next}
     RETURNING id`)) as unknown as Array<{ id: string }>;
      if (rows.length === 0) return;
      await auditEvent(tx, msg, p.active ? "activate" : "deactivate", "payroll_pay_group", p.id, {
        reason: p.reason, newValue: { status: next },
      });
    });
  });

  // ─── GAP-PAYROLL-PENSIONERS-03: stop / mark deceased ─────────────────────
  queue.subscribe(COMMANDS.pensionerSetStatus, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as {
      tenantId: string; id: string; from: string; to: "stopped" | "deceased"; reason: string; dateOfDeath: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const rows = (await tx.execute(sql`
        UPDATE payroll.payroll_pensioners
           SET status = ${p.to}, status_reason = ${p.reason}, status_changed_at = NOW(),
               status_changed_by = ${msg.actorId}::uuid,
               date_of_death = CASE WHEN ${p.to} = 'deceased' THEN ${p.dateOfDeath}::date ELSE date_of_death END,
               updated_by = ${msg.actorId}::uuid, updated_at = NOW()
         WHERE id = ${p.id}::uuid AND tenant_id = ${p.tenantId}::uuid AND status = ${p.from}
     RETURNING ppo_no`)) as unknown as Array<{ ppo_no: string }>;
      if (rows.length === 0) {
        log.warn({ id: p.id, from: p.from, to: p.to }, "pensioner status change was a no-op (state moved since the request)");
        return;
      }
      // No PPO number in the audit payload: the resource id identifies the record.
      await auditEvent(tx, msg, p.to === "deceased" ? "mark_deceased" : "stop_pension", "payroll_pensioner", p.id, {
        reason: p.reason,
        oldValue: { status: p.from },
        newValue: { status: p.to, ...(p.dateOfDeath ? { dateOfDeath: p.dateOfDeath } : {}) },
      });
    });
  });

  // ─── Read-side audit (PII reveal, pay-history read, receipt view) ───────
  queue.subscribe(COMMANDS.auditRecord, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as {
      action: string; resourceType: string; resourceId: string; details?: Record<string, unknown>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await auditEvent(tx, msg, p.action, p.resourceType, p.resourceId, p.details ?? {});
    });
  });

  // ─── GAP-PAYROLL-SALARY-REVISIONS-04: maker != checker decision ─────────
  queue.subscribe(COMMANDS.salaryRevisionDecide, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as { tenantId: string; id: string; decision: "approved" | "rejected"; note: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Race-safe: only a PENDING revision whose creator is somebody else
      // transitions; a concurrent decision or a self-approval updates nothing.
      const rows = (await tx.execute(sql`
        UPDATE payroll.payroll_salary_revisions
           SET status = ${p.decision}, decided_by = ${msg.actorId}::uuid, decided_at = NOW(),
               decision_note = ${p.note},
               approved_by = CASE WHEN ${p.decision} = 'approved' THEN ${msg.actorId}::uuid ELSE approved_by END
         WHERE id = ${p.id}::uuid AND tenant_id = ${p.tenantId}::uuid
           AND status = 'pending' AND created_by IS DISTINCT FROM ${msg.actorId}::uuid
     RETURNING employee_id::text AS employee_id, new_basic_minor::text AS new_basic_minor`)) as unknown as
        Array<{ employee_id: string; new_basic_minor: string }>;
      const row = rows[0];
      if (!row) {
        log.warn({ id: p.id, decision: p.decision }, "salary revision decision was a no-op (not pending, or decided by its creator)");
        return;
      }
      if (p.decision === "approved") {
        // The HRMS basic-pay sync (hrms integration consumer) listens to this
        // event, so it fires only once the second approver has signed off.
        await enqueue(tx, {
          topic: EVENTS.salaryRevisionCreated, eventType: EVENTS.salaryRevisionCreated,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { id: p.id, employeeId: row.employee_id, newBasicMinor: Number(row.new_basic_minor) }, // precision-ok: same JSON-number wire shape the HRMS sync consumer validates (safe integer)
        });
      }
      await auditEvent(tx, msg, p.decision === "approved" ? "approve" : "reject", "payroll_salary_revision", p.id, {
        ...(p.note ? { reason: p.note } : {}),
        newValue: { status: p.decision },
      });
    });
  });
}
