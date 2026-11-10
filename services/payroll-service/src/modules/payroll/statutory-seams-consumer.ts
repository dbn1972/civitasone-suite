/**
 * S8 statutory seams -- command consumers (routes in statutory-seams-routes.ts).
 * One transaction each: markProcessed -> write -> audit.event.record outbox event.
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

const audit = (tx: Tx, msg: Msg, action: string, resourceType: string, resourceId: string, details: Record<string, unknown>) =>
  enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { ...details, service: "payroll", action, resourceType, resourceId, outcome: "success" },
  });

export function registerStatutorySeamsConsumers(queue: Pick<Queue, "subscribe">): void {
  queue.subscribe(COMMANDS.s8SeamFlagsSet, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as { tenantId: string; lwfDeductionEnabled?: boolean; esiContributionPeriodEnabled?: boolean; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = await exec<{ lwf: boolean; esi: boolean }>(tx, sql`
        SELECT lwf_deduction_enabled AS lwf, esi_contribution_period_enabled AS esi
          FROM payroll.payroll_statutory_seams WHERE tenant_id = ${p.tenantId}::uuid FOR UPDATE`);
      await exec(tx, sql`
        INSERT INTO payroll.payroll_statutory_seams (tenant_id, lwf_deduction_enabled, esi_contribution_period_enabled, updated_by)
        VALUES (${p.tenantId}::uuid, COALESCE(${p.lwfDeductionEnabled ?? null}::boolean, false),
                COALESCE(${p.esiContributionPeriodEnabled ?? null}::boolean, false), ${msg.actorId}::uuid)
        ON CONFLICT (tenant_id) DO UPDATE SET
          lwf_deduction_enabled = COALESCE(${p.lwfDeductionEnabled ?? null}::boolean, payroll.payroll_statutory_seams.lwf_deduction_enabled),
          esi_contribution_period_enabled = COALESCE(${p.esiContributionPeriodEnabled ?? null}::boolean, payroll.payroll_statutory_seams.esi_contribution_period_enabled),
          updated_by = ${msg.actorId}::uuid, updated_at = NOW()`);
      await audit(tx, msg, "update", "payroll_statutory_seams", p.tenantId, {
        reason: p.reason,
        oldValue: before[0] ? { lwfDeductionEnabled: before[0].lwf, esiContributionPeriodEnabled: before[0].esi } : null,
        newValue: { lwfDeductionEnabled: p.lwfDeductionEnabled ?? null, esiContributionPeriodEnabled: p.esiContributionPeriodEnabled ?? null },
      });
    });
  });

  queue.subscribe(COMMANDS.s8PfBasisSet, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as { tenantId: string; employeeId: string; basis: "ceiling" | "actual"; effectiveFrom: string; consentRef: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Re-assert under the transaction that no finalised run covers the effective month (the route's check can be stale).
      const fin = await exec<{ month: string | null }>(tx, sql`
        SELECT MAX(month) AS month FROM payroll.payroll_runs WHERE tenant_id = ${p.tenantId}::uuid AND status IN ('approved', 'disbursed')`);
      if (fin[0]?.month && p.effectiveFrom.slice(0, 7) <= fin[0].month) {
        await audit(tx, msg, "pf_basis_rejected", "payroll_employee_pf_wage_basis", p.employeeId, { code: "PF_BASIS_BACKDATED", effectiveFrom: p.effectiveFrom });
        return;
      }
      const prev = await exec<{ basis: string }>(tx, sql`
        SELECT basis FROM payroll.employee_pf_wage_basis
         WHERE tenant_id = ${p.tenantId}::uuid AND employee_id = ${p.employeeId}::uuid AND effective_from <= ${p.effectiveFrom}::date
         ORDER BY effective_from DESC LIMIT 1`);
      await exec(tx, sql`
        INSERT INTO payroll.employee_pf_wage_basis (tenant_id, employee_id, basis, effective_from, consent_ref, set_by)
        VALUES (${p.tenantId}::uuid, ${p.employeeId}::uuid, ${p.basis}, ${p.effectiveFrom}::date, ${p.consentRef}, ${msg.actorId}::uuid)
        ON CONFLICT (tenant_id, employee_id, effective_from) DO UPDATE
          SET basis = EXCLUDED.basis, consent_ref = EXCLUDED.consent_ref, set_by = EXCLUDED.set_by`);
      await audit(tx, msg, "pf_basis_set", "payroll_employee_pf_wage_basis", p.employeeId, {
        oldValue: prev[0] ? { basis: prev[0].basis } : null,
        newValue: { basis: p.basis, effectiveFrom: p.effectiveFrom },
        consentRef: p.consentRef,
      });
    });
  });
}
