/**
 * S8 G7 consumers. One transaction per command: inbox dedup -> per-employee
 * advisory lock -> authoritative re-check -> write -> outbox event + audit. A
 * command that loses a race (sum above 100%, same-person approval, wrong state)
 * changes nothing and is recorded as a failed audit event.
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import type { AllocationDecidePayload, AllocationEndPayload, AllocationRequestPayload, CostGeneratePayload, CostingSettingsPayload } from "./commands.js";
import { FULL_BPS, nextDay, pctToBps } from "./domain.js";
import { lockEmployeeCosting, peakWithCandidate, reclassEmployeeTx, recordRunCostLinesTx } from "./service.js";

const AUDIT = "audit.event.record";

type Msg = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: unknown };
const rowsOf = <T>(r: unknown): T[] => Array.from(r as Iterable<T>);

function auditer(tx: Parameters<typeof enqueue>[0], msg: Msg, action: string, resourceType: string, resourceId: string) {
  return (outcome: "success" | "failure", detail: Record<string, unknown>) => enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "payroll", action, resourceType, resourceId, outcome, detail },
  });
}

export function registerProjectCostingConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.projectCostingSettings, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as CostingSettingsPayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = rowsOf<{ on: boolean }>(await tx.execute(sql`
        SELECT project_costing_enabled AS on FROM payroll.payroll_settings WHERE tenant_id = ${msg.tenantId}::uuid FOR UPDATE`));
      await tx.execute(sql`
        INSERT INTO payroll.payroll_settings (tenant_id, project_costing_enabled, created_at, updated_at)
        VALUES (${msg.tenantId}::uuid, ${p.enabled}, NOW(), NOW())
        ON CONFLICT (tenant_id) DO UPDATE SET project_costing_enabled = EXCLUDED.project_costing_enabled, updated_at = NOW()`);
      await enqueue(tx, {
        topic: EVENTS.projectCostingSettingsUpdated, eventType: EVENTS.projectCostingSettingsUpdated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { enabled: p.enabled },
      });
      await auditer(tx, msg, "project_costing_settings_updated", "payroll_settings", msg.tenantId)("success", { before: before[0]?.on ?? false, after: p.enabled });
    });
  });

  queue.subscribe(COMMANDS.costAllocationRequest, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as AllocationRequestPayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const audit = auditer(tx, msg, "cost_allocation_request", "payroll_cost_allocation", p.id);
      await lockEmployeeCosting(tx, msg.tenantId, p.employeeId);
      const bps = pctToBps(p.splitPct);
      const peak = await peakWithCandidate(tx, msg.tenantId, p.employeeId, { bps, from: p.effectiveFrom, to: p.effectiveTo }, ["active", "pending"]);
      if (peak > FULL_BPS) { await audit("failure", { code: "ALLOCATION_EXCEEDS_100", peakBps: peak, employeeId: p.employeeId }); return; }
      await tx.execute(sql`
        INSERT INTO payroll.employee_cost_allocations
          (id, tenant_id, employee_id, target_type, project_id, cost_center_id, split_pct, effective_from, effective_to, note, requested_by)
        VALUES (${p.id}::uuid, ${msg.tenantId}::uuid, ${p.employeeId}::uuid, ${p.targetType}, ${p.projectId}::uuid, ${p.costCenterId}::uuid,
                ${p.splitPct}, ${p.effectiveFrom}::date, ${p.effectiveTo}::date, ${p.note}, ${msg.actorId}::uuid)
        ON CONFLICT (id) DO NOTHING`);
      await enqueue(tx, {
        topic: EVENTS.costAllocationRequested, eventType: EVENTS.costAllocationRequested,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, employeeId: p.employeeId, targetType: p.targetType, projectId: p.projectId, costCenterId: p.costCenterId, splitPct: p.splitPct, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo },
      });
      await audit("success", { employeeId: p.employeeId, targetType: p.targetType, projectId: p.projectId, costCenterId: p.costCenterId, splitPct: p.splitPct, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo });
    });
  });

  queue.subscribe(COMMANDS.costAllocationDecide, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as AllocationDecidePayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const audit = auditer(tx, msg, `cost_allocation_${p.decision}`, "payroll_cost_allocation", p.id);
      const peek = rowsOf<{ employee_id: string }>(await tx.execute(sql`
        SELECT employee_id FROM payroll.employee_cost_allocations WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid`));
      if (!peek[0]) { await audit("failure", { code: "NOT_FOUND" }); return; }
      await lockEmployeeCosting(tx, msg.tenantId, peek[0].employee_id);
      const cur = rowsOf<{ employee_id: string; status: string; requested_by: string; split_pct: string; effective_from: string; effective_to: string | null }>(await tx.execute(sql`
        SELECT employee_id, status, requested_by, split_pct::text AS split_pct, effective_from::text AS effective_from, effective_to::text AS effective_to
          FROM payroll.employee_cost_allocations WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid FOR UPDATE`))[0]!;
      if (cur.status !== "pending") { await audit("failure", { code: "NOT_PENDING", status: cur.status }); return; }
      if (cur.requested_by === msg.actorId) { await audit("failure", { code: "SELF_APPROVAL" }); return; }
      if (p.decision === "approve") {
        const peak = await peakWithCandidate(tx, msg.tenantId, cur.employee_id, { bps: pctToBps(cur.split_pct), from: cur.effective_from, to: cur.effective_to }, ["active"], p.id);
        if (peak > FULL_BPS) { await audit("failure", { code: "ALLOCATION_EXCEEDS_100", peakBps: peak }); return; }
      }
      await tx.execute(sql`
        UPDATE payroll.employee_cost_allocations
           SET status = ${p.decision === "approve" ? "active" : "rejected"}, decided_by = ${msg.actorId}::uuid, decided_at = now(),
               decision_note = ${p.note}, updated_at = now(), version = version + 1
         WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid`);
      let reclass = { deltaLines: 0, months: 0 };
      if (p.decision === "approve") reclass = await reclassEmployeeTx(tx as never, msg, cur.employee_id, cur.effective_from, msg.messageId);
      await enqueue(tx, {
        topic: EVENTS.costAllocationDecided, eventType: EVENTS.costAllocationDecided,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, employeeId: cur.employee_id, decision: p.decision },
      });
      await audit("success", { employeeId: cur.employee_id, note: p.note, reclassDeltaLines: reclass.deltaLines, reclassMonths: reclass.months });
    });
  });

  queue.subscribe(COMMANDS.costAllocationEnd, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as AllocationEndPayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const audit = auditer(tx, msg, "cost_allocation_end", "payroll_cost_allocation", p.id);
      const peek = rowsOf<{ employee_id: string }>(await tx.execute(sql`
        SELECT employee_id FROM payroll.employee_cost_allocations WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid`));
      if (!peek[0]) { await audit("failure", { code: "NOT_FOUND" }); return; }
      await lockEmployeeCosting(tx, msg.tenantId, peek[0].employee_id);
      const cur = rowsOf<{ status: string; effective_from: string; effective_to: string | null }>(await tx.execute(sql`
        SELECT status, effective_from::text AS effective_from, effective_to::text AS effective_to
          FROM payroll.employee_cost_allocations WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid FOR UPDATE`))[0]!;
      if (cur.status !== "active") { await audit("failure", { code: "NOT_ACTIVE", status: cur.status }); return; }
      if (p.effectiveTo < cur.effective_from || (cur.effective_to !== null && p.effectiveTo >= cur.effective_to)) {
        await audit("failure", { code: "END_DATE_INVALID", effectiveTo: p.effectiveTo, from: cur.effective_from, currentTo: cur.effective_to });
        return;
      }
      await tx.execute(sql`
        UPDATE payroll.employee_cost_allocations
           SET effective_to = ${p.effectiveTo}::date, ended_by = ${msg.actorId}::uuid, ended_at = now(), updated_at = now(), version = version + 1
         WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid`);
      const reclass = await reclassEmployeeTx(tx as never, msg, peek[0].employee_id, nextDay(p.effectiveTo), msg.messageId);
      await audit("success", { employeeId: peek[0].employee_id, from: cur.effective_to, to: p.effectiveTo, reclassDeltaLines: reclass.deltaLines });
    });
  });

  queue.subscribe(COMMANDS.projectCostGenerate, async (m) => {
    const msg = m as unknown as Msg;
    const p = msg.payload as CostGeneratePayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const audit = auditer(tx, msg, "project_cost_generate", "payroll_run", p.runId);
      const run = rowsOf<{ month: string; status: string }>(await tx.execute(sql`
        SELECT month, status FROM payroll.payroll_runs WHERE id = ${p.runId}::uuid AND tenant_id = ${msg.tenantId}::uuid`))[0];
      if (!run || !["approved", "disbursed"].includes(run.status)) { await audit("failure", { code: "RUN_NOT_FINAL", status: run?.status ?? null }); return; }
      const res = await recordRunCostLinesTx(tx as never, msg, { id: p.runId, month: run.month });
      await audit("success", { ...res });
    });
  });
}
