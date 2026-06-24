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
import { sql } from "drizzle-orm";
import { computeSlip, assertRunStatusTransition, DomainError, type PensionScheme, type CityClass, type RawComponent, type SlipResult } from "./domain.js";
import { fetchPayrollInput } from "../../shared/hrms-client.js";

/** Resolve the DA rate (basis points) effective for the run month (Iter1). */
async function resolveDaRateBps(tenantId: string, month: string): Promise<bigint> {
  const rows = (await db.execute(sql`
    SELECT rate_bps FROM payroll.dearness_allowance_rates
    WHERE tenant_id = ${tenantId}::uuid AND effective_from <= ${month + "-01"}::date
    ORDER BY effective_from DESC LIMIT 1
  `)) as unknown as Array<{ rate_bps: number | string }>;
  const v = rows[0]?.rate_bps;
  return v != null ? BigInt(v) : 0n;
}

/** Active Professional Tax slabs for the tenant (Iter5). */
async function resolvePtSlabs(tenantId: string): Promise<Array<{ from: bigint; to: bigint; amount: bigint }>> {
  const rows = (await db.execute(sql`
    SELECT slab_from_minor, slab_to_minor, pt_amount_minor
    FROM payroll.payroll_professional_tax
    WHERE tenant_id = ${tenantId}::uuid AND is_active = true
    ORDER BY slab_from_minor
  `)) as unknown as Array<{ slab_from_minor: string | number; slab_to_minor: string | number; pt_amount_minor: string | number }>;
  return rows.map((r) => ({ from: BigInt(r.slab_from_minor), to: BigInt(r.slab_to_minor), amount: BigInt(r.pt_amount_minor) }));
}

function resolvePt(slabs: Array<{ from: bigint; to: bigint; amount: bigint }>, incomeMinor: bigint): bigint {
  const s = slabs.find((x) => incomeMinor >= x.from && incomeMinor <= x.to);
  return s ? s.amount : 0n;
}

/** Employee's submitted tax declaration for the FY (drives old-regime TDS exemptions). */
async function resolveDeclaration(tenantId: string, employeeId: string, fy: string): Promise<{
  regime: "old" | "new"; rentPaidAnnualMinor: bigint; ded80cMinor: bigint; ded80dMinor: bigint; otherDedMinor: bigint;
} | null> {
  const rows = (await db.execute(sql`
    SELECT regime, section_80c, section_80d, other_deductions,
           COALESCE(rent_paid_minor, 0) AS rent_paid_minor
    FROM payroll.payroll_tax_declarations
    WHERE tenant_id = ${tenantId}::uuid AND employee_id = ${employeeId}::uuid AND fy = ${fy}
    ORDER BY created_at DESC LIMIT 1
  `)) as unknown as Array<{ regime: string; section_80c: string | number; section_80d: string | number; other_deductions: string | number; rent_paid_minor: string | number }>;
  const d = rows[0];
  if (!d) return null;
  return {
    regime: d.regime === "old" ? "old" : "new",
    rentPaidAnnualMinor: BigInt(d.rent_paid_minor),
    ded80cMinor: BigInt(d.section_80c),
    ded80dMinor: BigInt(d.section_80d),
    otherDedMinor: BigInt(d.other_deductions),
  };
}

/** TDS already deducted this FY before the given run month (for Sec 192 true-up). */
async function resolveTdsYtdMinor(tenantId: string, employeeId: string, fyStart: number, beforeMonth: string): Promise<bigint> {
  const rows = (await db.execute(sql`
    SELECT COALESCE(SUM(tds_minor), 0)::text AS ytd
    FROM statutory.payroll_tds
    WHERE tenant_id = ${tenantId}::uuid AND employee_id = ${employeeId}::uuid
      AND period >= ${`${fyStart}-04`} AND period < ${beforeMonth}
  `)) as unknown as Array<{ ytd: string | number }>;
  return BigInt(rows[0]?.ytd ?? 0);
}

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
      // Iter2: prevent a second (non-failed) regular run for the same tenant+month.
      const dup = (await tx.execute(sql`
        SELECT 1 FROM payroll.payroll_runs
        WHERE tenant_id = ${p.tenantId}::uuid AND month = ${p.month} AND status <> 'failed'
        LIMIT 1
      `)) as unknown as Array<unknown>;
      if (dup.length > 0) {
        throw new DomainError("DUPLICATE_RUN_FOR_PERIOD", `a payroll run already exists for ${p.month}`);
      }
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
      // Iter2: maker-checker — the approver must differ from the run creator.
      if (run.createdBy === p.approvedBy) {
        throw new DomainError("SELF_APPROVAL_FORBIDDEN", "payroll run approver must differ from its creator");
      }
      assertRunStatusTransition(run.status, "approved");
      const slips = await repo.listSlipsByRun(p.id, p.tenantId);
      const totalGross = slips.reduce((s, sl) => s + sl.grossMinor, 0n);
      const totalNet = slips.reduce((s, sl) => s + sl.netPayMinor, 0n);
      const totalEmployerContrib = await statutoryRepo.sumEmployerContribByRun(p.id, p.tenantId);
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
          totalEmployerContribMinor: totalEmployerContrib.toString(),
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
      // Iter2: reconcile the disbursed amount against the authoritative slip sum,
      // never the denormalized counter (which the audit found could drift).
      const slips = await repo.listSlipsByRun(p.id, p.tenantId);
      const slipNet = slips
        .filter((s) => s.status !== "exception")
        .reduce((acc, s) => acc + s.netPayMinor, 0n);
      if (slipNet !== run.totalNetMinor) {
        throw new DomainError("DISBURSE_RECONCILIATION_FAILED", `run net ${run.totalNetMinor} != slip sum ${slipNet}`);
      }
      await repo.updateRun(tx, p.id, { status: "disbursed", disbursedAt: new Date(), updatedBy: msg.actorId });
      await enqueue(tx, {
        topic: EVENTS.runDisbursed, eventType: EVENTS.runDisbursed,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { runId: p.id, month: run.month, totalNetMinor: slipNet.toString() },
      });
      await enqueue(tx, {
        topic: EFT_INITIATE, eventType: EFT_INITIATE,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          payrollRunId: p.id,
          amountMinor: slipNet.toString(),
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
  const daRateBps = await resolveDaRateBps(p.tenantId, p.month);
  const ptSlabs = await resolvePtSlabs(p.tenantId);
  // Days in the run month (LOP divisor) — 7th CPC uses actual days, not flat 30.
  const daysInMonth = BigInt(new Date(Number(p.month.slice(0, 4)), Number(p.month.slice(5, 7)), 0).getDate());
  let totalGross = 0n;
  let totalNet = 0n;

  const rawComponents: RawComponent[] = structComps.map((c) => ({
    code: c.code,
    name: c.name,
    type: c.componentType as "earning" | "deduction",
    fixedMinor: c.fixedMinor ?? null,
    pctOfBasic: c.pctOfBasic != null ? Number(c.pctOfBasic) : null,
  }));

  await db.transaction(async (tx) => {
    for (const emp of input.employees) {
      if (p.departmentId && emp.departmentId !== p.departmentId) continue;

      const basicMinor = BigInt(emp.basicMinor);
      const daMinor = (basicMinor * daRateBps) / 10000n;
      const lopDays =
        (input.lopDays[emp.id] ?? 0) + await lopRepo.sumLopDays(p.tenantId, emp.id, p.month);
      // LOP daily rate on (Basic + DA) over actual days in month.
      const dailyRate = (basicMinor + daMinor) / daysInMonth;
      const lopDeduction = dailyRate * BigInt(lopDays);

      // Iter2: real loan recovery — split interest/principal, cap at outstanding,
      // record a repayment, decrement outstanding, close the loan at zero.
      const loans = await loansRepo.findLoansByEmployee(p.tenantId, emp.id);
      let emiTotal = 0n;
      for (const l of loans) {
        if (l.status !== "disbursed" || l.outstandingMinor <= 0n) continue;
        const monthlyRateBps = BigInt(Math.round(Number(l.interestRatePct ?? 0) * 100)); // pct -> bps
        const interest = (l.outstandingMinor * monthlyRateBps) / 120000n; // /100/12 in bps
        let principal = l.emiMinor - interest;
        if (principal < 0n) principal = 0n;
        if (principal > l.outstandingMinor) principal = l.outstandingMinor;
        const deduction = principal + interest;
        if (deduction <= 0n) continue;
        emiTotal += deduction;
        const newOutstanding = l.outstandingMinor - principal;
        const installmentNo = (await loansRepo.countRepayments(tx, l.id)) + 1;
        await loansRepo.insertRepayment(tx, {
          id: randomUUID(), tenantId: p.tenantId, loanId: l.id, runId: p.id,
          installmentNo, principalMinor: principal, interestMinor: interest, totalMinor: deduction,
          currency: "INR", status: "paid", paidAt: new Date(),
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await loansRepo.updateLoan(tx, l.id, {
          outstandingMinor: newOutstanding,
          status: newOutstanding <= 0n ? "closed" : "disbursed",
          updatedBy: msg.actorId,
        });
      }

      const adHoc = [];
      if (lopDeduction > 0n) adHoc.push({ code: "LOP", name: "Loss of Pay", type: "deduction" as const, amountMinor: lopDeduction });
      if (emiTotal > 0n) adHoc.push({ code: "LOAN_EMI", name: "Loan EMI", type: "deduction" as const, amountMinor: emiTotal });

      const fyStart = Number(p.month.slice(5, 7)) >= 4 ? Number(p.month.slice(0, 4)) : Number(p.month.slice(0, 4)) - 1;
      const fyStr = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
      const decl = await resolveDeclaration(p.tenantId, emp.id, fyStr);
      const monthIdxInFy = (Number(p.month.slice(5, 7)) - 4 + 12) % 12; // Apr=0..Mar=11
      const tdsYtdMinor = await resolveTdsYtdMinor(p.tenantId, emp.id, fyStart, p.month);

      const result = await computeAndInsertSlip(tx, msg, {
        runId: p.id,
        tenantId: p.tenantId,
        employeeId: emp.id,
        employeeNo: emp.employeeNo,
        basicMinor,
        month: p.month,
        pensionScheme: emp.pensionScheme ?? "NPS",
        daRateBps,
        cityClass: ((emp as { cityClass?: string }).cityClass as CityClass) ?? "X",
        ptMinor: resolvePt(ptSlabs, basicMinor + daMinor),
        taxRegime: decl?.regime ?? ((emp as { taxRegime?: "old" | "new" }).taxRegime) ?? "new",
        fyStartYear: fyStart,
        tdsYtdMinor,
        monthsRemaining: 12 - monthIdxInFy,
        ...(decl ? { declaration: { rentPaidAnnualMinor: decl.rentPaidAnnualMinor, ded80cMinor: decl.ded80cMinor, ded80dMinor: decl.ded80dMinor, otherDedMinor: decl.otherDedMinor } } : {}),
        rawComponents,
        components: adHoc,
      });

      // Single source of truth: totals come from the same computed result.
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
    daRateBps?: bigint; cityClass?: CityClass; ptMinor?: bigint;
    taxRegime?: "old" | "new"; fyStartYear?: number;
    tdsYtdMinor?: bigint; monthsRemaining?: number;
    declaration?: { rentPaidAnnualMinor?: bigint; ded80cMinor?: bigint; ded80dMinor?: bigint; otherDedMinor?: bigint };
    rawComponents?: RawComponent[];
    components?: Array<{ code: string; name: string; type: "earning" | "deduction"; amountMinor: bigint }>;
  },
): Promise<SlipResult> {
  const result = computeSlip({
    basicMinor: params.basicMinor,
    daRateBps: params.daRateBps ?? 0n,
    cityClass: params.cityClass ?? "X",
    ptMinor: params.ptMinor ?? 0n,
    taxRegime: params.taxRegime ?? "new",
    fyStartYear: params.fyStartYear ?? 2025,
    ...(params.tdsYtdMinor != null ? { tdsYtdMinor: params.tdsYtdMinor } : {}),
    ...(params.monthsRemaining != null ? { monthsRemaining: params.monthsRemaining } : {}),
    ...(params.declaration ? { declaration: params.declaration } : {}),
    rawComponents: params.rawComponents ?? [],
    components: params.components ?? [],
    pensionScheme: params.pensionScheme ?? "NPS",
  });
  const slipId = randomUUID();
  const allComps = [...result.earnings, ...result.deductions];
  await repo.insertSlip(tx, {
    id: slipId, tenantId: params.tenantId, runId: params.runId,
    employeeId: params.employeeId, employeeNo: params.employeeNo,
    basicMinor: params.basicMinor, grossMinor: result.grossMinor,
    totalDeductionsMinor: result.totalDeductionsMinor, netPayMinor: result.netPayMinor,
    components: allComps.map((c) => ({ code: c.code, name: c.name, type: c.type, amountMinor: Number(c.amountMinor) })),
    pfEmployeeMinor: result.pfEmployeeMinor, pfEmployerMinor: result.pfEmployerMinor,
    gpfMinor: result.gpfMinor, npsEmployeeMinor: result.npsEmployeeMinor, npsEmployerMinor: result.npsEmployerMinor,
    esiMinor: result.esiMinor, tdsMinor: result.tdsMinor,
    status: result.negativeNet ? "exception" : "computed",
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
      epsContribMinor: result.epsMinor, epfErContribMinor: result.epfEmployerMinor,
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
    taxableMinor: result.annualTaxableMinor,
    tdsMinor: result.tdsMinor, currency: "INR", period: params.month,
    createdBy: msg.actorId, updatedBy: msg.actorId,
  });
  return result;
}

async function audit(tx: Parameters<typeof enqueue>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "payroll", action, resourceType, resourceId, outcome: "success" },
  });
}
