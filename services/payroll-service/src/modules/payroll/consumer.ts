import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as loansRepo from "../loans/repo.js";
import * as lopRepo from "../integration/lop-repo.js";
import * as statutoryRepo from "../statutory/repo.js";
import { computeSlip, assertRunStatusTransition, type PensionScheme } from "./domain.js";
import { fetchPayrollInput } from "../../shared/hrms-client.js";

const AUDIT = "audit.event.record";
const EFT_INITIATE = "finance.payment.eft.initiate";

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
    const p = msg.payload as {
      id: string; tenantId: string; runNo: string; month: string;
      departmentId?: string; structureId: string;
    };
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
    try {
      await processPayrollRun(msg, p);
    } catch (err) {
      await db.transaction(async (tx) => {
        await repo.updateRun(tx, p.id, { status: "failed", updatedBy: msg.actorId });
      });
      throw err;
    }
  });

  queue.subscribe(COMMANDS.runApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; approvedBy: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const run = await repo.findRunByIdTx(tx, p.id);
      if (!run) throw new Error(`payroll run ${p.id} not found`);
      assertRunStatusTransition(run.status, "approved");
      const slips = await repo.listSlipsByRun(p.id, p.tenantId);
      const totalGross = slips.reduce((s, sl) => s + sl.grossMinor, 0n);
      const totalNet = slips.reduce((s, sl) => s + sl.netPayMinor, 0n);
      await repo.updateRun(tx, p.id, {
        status: "approved",
        totalGrossMinor: totalGross,
        totalNetMinor: totalNet,
        approvedBy: p.approvedBy,
        approvedAt: new Date(),
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.runApproved, eventType: EVENTS.runApproved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          runId: p.id,
          month: run.month,
          totalGrossMinor: totalGross.toString(),
          totalNetMinor: totalNet.toString(),
        },
      });
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: "payroll.run.approved",
          recipient: p.approvedBy,
          variables: { runId: p.id, month: run.month },
        }),
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
      await enqueue(tx, {
        topic: EVENTS.runDisbursed, eventType: EVENTS.runDisbursed,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { runId: p.id, month: run.month, totalNetMinor: run.totalNetMinor.toString() },
      });
      await enqueue(tx, {
        topic: EFT_INITIATE, eventType: EFT_INITIATE,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          payrollRunId: p.id,
          amountMinor: run.totalNetMinor.toString(),
          currency: run.currency,
          mode: "neft",
          pfmsTxnId: `PAYROLL-${p.id.slice(0, 8)}`,
        },
      });
      await audit(tx, msg, "disburse", "payroll_run", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "payroll_run", p.id));
  });
}

async function processPayrollRun(
  msg: { tenantId: string; actorId: string; correlationId: string },
  p: { id: string; tenantId: string; month: string; structureId: string; departmentId?: string },
): Promise<void> {
  const input = await fetchPayrollInput(p.tenantId, p.month);
  const structComps = await repo.listComponentsByStructure(p.structureId, p.tenantId);
  let totalGross = 0n;
  let totalNet = 0n;

  await db.transaction(async (tx) => {
    for (const emp of input.employees) {
      if (p.departmentId && emp.departmentId !== p.departmentId) continue;

      const basicMinor = BigInt(emp.basicMinor);
      const lopDays =
        (input.lopDays[emp.id] ?? 0) + await lopRepo.sumLopDays(p.tenantId, emp.id, p.month);
      const dailyRate = basicMinor / 30n;
      const lopDeduction = dailyRate * BigInt(lopDays);

      const loans = await loansRepo.findLoansByEmployee(p.tenantId, emp.id);
      const emiTotal = loans
        .filter((l) => l.status === "disbursed")
        .reduce((s, l) => s + l.emiMinor, 0n);

      const components = structComps
        .filter((c) => c.code !== "BASIC")
        .map((c) => ({
          code: c.code,
          name: c.name,
          type: c.componentType as "earning" | "deduction",
          amountMinor: Number(c.fixedMinor ?? 0n),
        }));

      if (lopDeduction > 0n) {
        components.push({ code: "LOP", name: "Loss of Pay", type: "deduction", amountMinor: Number(lopDeduction) });
      }
      if (emiTotal > 0n) {
        components.push({ code: "LOAN_EMI", name: "Loan EMI", type: "deduction", amountMinor: Number(emiTotal) });
      }

      await computeAndInsertSlip(tx, msg, {
        runId: p.id,
        tenantId: p.tenantId,
        employeeId: emp.id,
        employeeNo: emp.employeeNo,
        basicMinor,
        month: p.month,
        pensionScheme: emp.pensionScheme ?? "NPS",
        components,
      });

      const comps = components.map((c) => ({ ...c, amountMinor: BigInt(c.amountMinor) }));
      const result = computeSlip({ basicMinor, components: comps, pensionScheme: emp.pensionScheme ?? "NPS" });
      totalGross += result.grossMinor;
      totalNet += result.netPayMinor;
    }

    await repo.updateRun(tx, p.id, {
      totalGrossMinor: totalGross,
      totalNetMinor: totalNet,
      status: "processing",
      updatedBy: msg.actorId,
    });
  });
}

export async function computeAndInsertSlip(
  tx: Parameters<typeof repo.insertSlip>[0],
  msg: { actorId: string },
  params: {
    runId: string; tenantId: string; employeeId: string; employeeNo: string;
    basicMinor: bigint; month: string; pensionScheme?: PensionScheme;
    components?: Array<{ code: string; name: string; type: "earning" | "deduction"; amountMinor: number }>;
  },
): Promise<void> {
  const comps = (params.components ?? []).map((c) => ({ ...c, amountMinor: BigInt(c.amountMinor) }));
  const result = computeSlip({
    basicMinor: params.basicMinor,
    components: comps,
    pensionScheme: params.pensionScheme ?? "NPS",
  });
  const slipId = randomUUID();
  await repo.insertSlip(tx, {
    id: slipId, tenantId: params.tenantId, runId: params.runId,
    employeeId: params.employeeId, employeeNo: params.employeeNo,
    basicMinor: params.basicMinor, grossMinor: result.grossMinor,
    totalDeductionsMinor: result.totalDeductionsMinor, netPayMinor: result.netPayMinor,
    components: comps.map((c) => ({ ...c, amountMinor: Number(c.amountMinor) })),
    pfEmployeeMinor: result.pfEmployeeMinor, pfEmployerMinor: result.pfEmployerMinor,
    gpfMinor: result.gpfMinor, npsEmployeeMinor: result.npsEmployeeMinor, npsEmployerMinor: result.npsEmployerMinor,
    esiMinor: result.esiMinor, tdsMinor: result.tdsMinor, status: "computed",
    createdBy: msg.actorId, updatedBy: msg.actorId,
  });
  if (result.gpfMinor > 0n) {
    await statutoryRepo.insertGpf(tx, {
      id: randomUUID(), tenantId: params.tenantId, slipId, employeeId: params.employeeId,
      runId: params.runId, basicMinor: params.basicMinor,
      contribPct: "10", empContribMinor: result.gpfMinor,
      currency: "INR", period: params.month,
      createdBy: msg.actorId, updatedBy: msg.actorId,
    });
  } else if (result.npsEmployeeMinor > 0n) {
    await statutoryRepo.insertNps(tx, {
      id: randomUUID(), tenantId: params.tenantId, slipId, employeeId: params.employeeId,
      runId: params.runId, basicMinor: params.basicMinor,
      empContribPct: "10", erContribPct: "14",
      empContribMinor: result.npsEmployeeMinor, erContribMinor: result.npsEmployerMinor,
      currency: "INR", period: params.month,
      createdBy: msg.actorId, updatedBy: msg.actorId,
    });
  } else {
    await statutoryRepo.insertPf(tx, {
      id: randomUUID(), tenantId: params.tenantId, slipId, employeeId: params.employeeId,
      runId: params.runId, basicMinor: params.basicMinor,
      empContribPct: "12", erContribPct: "12",
      empContribMinor: result.pfEmployeeMinor, erContribMinor: result.pfEmployerMinor,
      currency: "INR", period: params.month,
      createdBy: msg.actorId, updatedBy: msg.actorId,
    });
  }
  if (result.esiMinor > 0n) {
    await statutoryRepo.insertEsi(tx, {
      id: randomUUID(), tenantId: params.tenantId, slipId, employeeId: params.employeeId,
      runId: params.runId, grossMinor: result.grossMinor,
      empContribMinor: result.esiMinor,
      erContribMinor: (result.grossMinor * 325n) / 10000n,
      currency: "INR", period: params.month,
      createdBy: msg.actorId, updatedBy: msg.actorId,
    });
  }
  await statutoryRepo.insertTds(tx, {
    id: randomUUID(), tenantId: params.tenantId, slipId, employeeId: params.employeeId,
    runId: params.runId, annualBasicMinor: params.basicMinor * 12n,
    taxableMinor: params.basicMinor * 12n > 50_000_000n ? params.basicMinor * 12n - 50_000_000n : 0n,
    tdsMinor: result.tdsMinor, currency: "INR", period: params.month,
    createdBy: msg.actorId, updatedBy: msg.actorId,
  });
}

async function audit(tx: Parameters<typeof enqueue>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "payroll", action, resourceType, resourceId, outcome: "success" },
  });
}
