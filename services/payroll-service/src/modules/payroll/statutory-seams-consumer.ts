/**
 * S8 statutory seams -- command consumers (routes in statutory-seams-routes.ts).
 * Maker-checker: the set commands only record a PENDING payroll_s8_change_requests row; the decide command
 * (a DIFFERENT actor, enforced by a conditional UPDATE and a CHECK constraint) applies an approved request.
 * One transaction each: markProcessed -> write -> audit.event.record outbox event (both steps are audited).
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const AUDIT = "audit.event.record";
type Msg = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: unknown };
type Tx = Parameters<typeof enqueue>[0];

async function exec<T = Record<string, unknown>>(tx: Tx, q: ReturnType<typeof sql>): Promise<T[]> {
  return (await (tx as unknown as { execute: (x: unknown) => Promise<unknown> }).execute(q)) as T[];
}

const audit = (tx: Tx, msg: Msg, action: string, resourceType: string, resourceId: string, details: Record<string, unknown>, outcome = "success") =>
  enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { ...details, service: "payroll", action, resourceType, resourceId, outcome },
  });

export function registerStatutorySeamsConsumers(queue: Pick<Queue, "subscribe">): void {
  // ─── a maker requests a flag change ─────────────────────────────────────
  queue.subscribe(COMMANDS.s8SeamFlagsSet, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as { tenantId: string; lwfDeductionEnabled?: boolean; esiContributionPeriodEnabled?: boolean; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const payload = { lwfDeductionEnabled: p.lwfDeductionEnabled ?? null, esiContributionPeriodEnabled: p.esiContributionPeriodEnabled ?? null };
      await exec(tx, sql`
        INSERT INTO payroll.payroll_s8_change_requests (id, tenant_id, kind, payload, reason, requested_by)
        VALUES (${msg.messageId}::uuid, ${p.tenantId}::uuid, 'flags', ${JSON.stringify(payload)}::jsonb, ${p.reason}, ${msg.actorId}::uuid)
        ON CONFLICT (id) DO NOTHING`);
      await audit(tx, msg, "flags_request", "payroll_statutory_seams", p.tenantId, { reason: p.reason, requestId: msg.messageId, newValue: payload });
    });
  });

  // ─── a maker requests a per-employee PF wage basis ──────────────────────
  queue.subscribe(COMMANDS.s8PfBasisSet, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as { tenantId: string; employeeId: string; basis: "ceiling" | "actual"; effectiveFrom: string; consentRef: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await exec(tx, sql`
        INSERT INTO payroll.payroll_s8_change_requests (id, tenant_id, kind, employee_id, payload, reason, requested_by)
        VALUES (${msg.messageId}::uuid, ${p.tenantId}::uuid, 'pf_basis', ${p.employeeId}::uuid,
                ${JSON.stringify({ basis: p.basis, effectiveFrom: p.effectiveFrom })}::jsonb, ${p.consentRef}, ${msg.actorId}::uuid)
        ON CONFLICT (id) DO NOTHING`);
      await audit(tx, msg, "pf_basis_request", "payroll_employee_pf_wage_basis", p.employeeId, {
        requestId: msg.messageId, consentRef: p.consentRef, newValue: { basis: p.basis, effectiveFrom: p.effectiveFrom },
      });
    });
  });

  // ─── a DIFFERENT administrator approves or rejects ──────────────────────
  queue.subscribe(COMMANDS.s8ChangeDecide, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as { tenantId: string; id: string; decision: "approved" | "rejected"; note: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Race-safe: only a request that is STILL pending and whose maker is somebody else transitions.
      const rows = await exec<{ kind: string; employee_id: string | null; payload: Record<string, unknown>; reason: string }>(tx, sql`
        UPDATE payroll.payroll_s8_change_requests
           SET status = ${p.decision}, decided_by = ${msg.actorId}::uuid, decided_at = NOW(), decision_note = ${p.note}
         WHERE id = ${p.id}::uuid AND tenant_id = ${p.tenantId}::uuid AND status = 'pending' AND requested_by <> ${msg.actorId}::uuid
     RETURNING kind, employee_id::text AS employee_id, payload, reason`);
      const r = rows[0];
      if (!r) {
        await audit(tx, msg, "decide_refused", "payroll_s8_change_request", p.id, { decision: p.decision }, "failure");
        return;
      }
      if (p.decision === "rejected") {
        await audit(tx, msg, "reject", "payroll_s8_change_request", p.id, { kind: r.kind, note: p.note });
        return;
      }
      if (r.kind === "flags") {
        const f = r.payload as { lwfDeductionEnabled: boolean | null; esiContributionPeriodEnabled: boolean | null };
        const before = await exec<{ lwf: boolean; esi: boolean }>(tx, sql`
          SELECT lwf_deduction_enabled AS lwf, esi_contribution_period_enabled AS esi
            FROM payroll.payroll_statutory_seams WHERE tenant_id = ${p.tenantId}::uuid FOR UPDATE`);
        await exec(tx, sql`
          INSERT INTO payroll.payroll_statutory_seams (tenant_id, lwf_deduction_enabled, esi_contribution_period_enabled, updated_by)
          VALUES (${p.tenantId}::uuid, COALESCE(${f.lwfDeductionEnabled}::boolean, false), COALESCE(${f.esiContributionPeriodEnabled}::boolean, false), ${msg.actorId}::uuid)
          ON CONFLICT (tenant_id) DO UPDATE SET
            lwf_deduction_enabled = COALESCE(${f.lwfDeductionEnabled}::boolean, payroll.payroll_statutory_seams.lwf_deduction_enabled),
            esi_contribution_period_enabled = COALESCE(${f.esiContributionPeriodEnabled}::boolean, payroll.payroll_statutory_seams.esi_contribution_period_enabled),
            updated_by = ${msg.actorId}::uuid, updated_at = NOW()`);
        await audit(tx, msg, "flags_approve", "payroll_statutory_seams", p.tenantId, {
          requestId: p.id, reason: r.reason, note: p.note,
          oldValue: before[0] ? { lwfDeductionEnabled: before[0].lwf, esiContributionPeriodEnabled: before[0].esi } : null, newValue: f,
        });
        return;
      }
      // pf_basis: re-assert under the transaction that no finalised run covers the effective month.
      const pf = r.payload as { basis: "ceiling" | "actual"; effectiveFrom: string };
      const fin = await exec<{ month: string | null }>(tx, sql`
        SELECT MAX(month) AS month FROM payroll.payroll_runs WHERE tenant_id = ${p.tenantId}::uuid AND status IN ('approved', 'disbursed')`);
      if (fin[0]?.month && pf.effectiveFrom.slice(0, 7) <= fin[0].month) {
        await exec(tx, sql`UPDATE payroll.payroll_s8_change_requests SET status = 'rejected', code = 'PF_BASIS_BACKDATED' WHERE id = ${p.id}::uuid AND tenant_id = ${p.tenantId}::uuid`);
        await audit(tx, msg, "pf_basis_rejected", "payroll_employee_pf_wage_basis", r.employee_id ?? p.id, { requestId: p.id, code: "PF_BASIS_BACKDATED", effectiveFrom: pf.effectiveFrom }, "failure");
        return;
      }
      const prev = await exec<{ basis: string }>(tx, sql`
        SELECT basis FROM payroll.employee_pf_wage_basis
         WHERE tenant_id = ${p.tenantId}::uuid AND employee_id = ${r.employee_id}::uuid AND effective_from <= ${pf.effectiveFrom}::date
         ORDER BY effective_from DESC LIMIT 1`);
      await exec(tx, sql`
        INSERT INTO payroll.employee_pf_wage_basis (tenant_id, employee_id, basis, effective_from, consent_ref, set_by)
        VALUES (${p.tenantId}::uuid, ${r.employee_id}::uuid, ${pf.basis}, ${pf.effectiveFrom}::date, ${r.reason}, ${msg.actorId}::uuid)
        ON CONFLICT (tenant_id, employee_id, effective_from) DO UPDATE
          SET basis = EXCLUDED.basis, consent_ref = EXCLUDED.consent_ref, set_by = EXCLUDED.set_by`);
      await audit(tx, msg, "pf_basis_approve", "payroll_employee_pf_wage_basis", r.employee_id ?? p.id, {
        requestId: p.id, consentRef: r.reason, note: p.note,
        oldValue: prev[0] ? { basis: prev[0].basis } : null, newValue: pf,
      });
    });
  });
}
