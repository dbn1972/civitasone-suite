import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as statutoryRepo from "../statutory/repo.js";
import { computeSlip, assertRunStatusTransition } from "./domain.js";

const AUDIT = "audit.event.record";

export function registerPayrollConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.structureCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; name: string; description?: string; isDefault: boolean };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertStructure(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name,
        description: p.description ?? null, isDefault: p.isDefault, status: "active",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "payroll_structure", p.id);
    });
  });

  queue.subscribe(COMMANDS.runCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; runNo: string; month: string; departmentId?: string; structureId: string; status: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRun(tx, {
        id: p.id, tenantId: p.tenantId, runNo: p.runNo, month: p.month,
        departmentId: p.departmentId ?? null, structureId: p.structureId,
        totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status: "processing",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "payroll_run", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "payroll_run", p.id));
  });

  queue.subscribe(COMMANDS.runApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; approvedBy: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const run = await repo.findRunByIdTx(tx, p.id);
      if (!run) throw new Error(`payroll run ${p.id} not found`);
      assertRunStatusTransition(run.status, "approved");
      await repo.updateRun(tx, p.id, { status: "approved", approvedBy: p.approvedBy, approvedAt: new Date(), updatedBy: msg.actorId });
      await enqueue(tx, {
        topic: EVENTS.runApproved, eventType: EVENTS.runApproved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { runId: p.id, month: run.month, totalNetMinor: run.totalNetMinor.toString() },
      });
      await audit(tx, msg, "approve", "payroll_run", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "payroll_run", p.id));
  });

  queue.subscribe(COMMANDS.runDisburse, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const run = await repo.findRunByIdTx(tx, p.id);
      if (!run) throw new Error(`payroll run ${p.id} not found`);
      assertRunStatusTransition(run.status, "disbursed");
      await repo.updateRun(tx, p.id, { status: "disbursed", disbursedAt: new Date(), updatedBy: msg.actorId });
      await audit(tx, msg, "disburse", "payroll_run", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "payroll_run", p.id));
  });
}

export async function computeAndInsertSlip(
  tx: any, msg: any,
  params: {
    runId: string; tenantId: string; employeeId: string; employeeNo: string;
    basicMinor: bigint; month: string;
    components?: Array<{ code: string; name: string; type: "earning" | "deduction"; amountMinor: number }>;
  }
): Promise<void> {
  const comps = (params.components ?? []).map((c) => ({ ...c, amountMinor: BigInt(c.amountMinor) }));
  const result = computeSlip({ basicMinor: params.basicMinor, components: comps });
  const slipId = randomUUID();
  await repo.insertSlip(tx, {
    id: slipId, tenantId: params.tenantId, runId: params.runId,
    employeeId: params.employeeId, employeeNo: params.employeeNo,
    basicMinor: params.basicMinor, grossMinor: result.grossMinor,
    totalDeductionsMinor: result.totalDeductionsMinor, netPayMinor: result.netPayMinor,
    components: comps.map((c) => ({ ...c, amountMinor: Number(c.amountMinor) })),
    pfEmployeeMinor: result.pfEmployeeMinor, pfEmployerMinor: result.pfEmployerMinor,
    esiMinor: result.esiMinor, tdsMinor: result.tdsMinor, status: "computed",
    createdBy: msg.actorId, updatedBy: msg.actorId,
  });
  await statutoryRepo.insertPf(tx, {
    id: randomUUID(), tenantId: params.tenantId, slipId, employeeId: params.employeeId,
    runId: params.runId, basicMinor: params.basicMinor,
    empContribPct: "12", erContribPct: "12",
    empContribMinor: result.pfEmployeeMinor, erContribMinor: result.pfEmployerMinor,
    currency: "INR", period: params.month,
    createdBy: msg.actorId, updatedBy: msg.actorId,
  });
  await statutoryRepo.insertTds(tx, {
    id: randomUUID(), tenantId: params.tenantId, slipId, employeeId: params.employeeId,
    runId: params.runId, annualBasicMinor: params.basicMinor * 12n,
    taxableMinor: params.basicMinor * 12n > 50_000_000n ? params.basicMinor * 12n - 50_000_000n : 0n,
    tdsMinor: result.tdsMinor, currency: "INR", period: params.month,
    createdBy: msg.actorId, updatedBy: msg.actorId,
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "payroll", action, resourceType, resourceId, outcome: "success" },
  });
}
