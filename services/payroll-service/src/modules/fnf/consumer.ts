/**
 * F&F Settlement consumer — processes payroll.fnf.compute commands.
 *
 * Flow: markProcessed → load ceilings → computeFnfSettlement → persist → emit events → audit.
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { fnfSettlements, exemptionCeilings } from "./schema.js";
import { computeFnfSettlement, type FnfInput } from "./domain.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const AUDIT = "audit.event.record";

export function registerFnfConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.fnfCompute, async (msg) => {
    const p = msg.payload as {
      employeeId: string;
      tenantId: string;
      separationDate: string;
      separationType: string;
      employeeCategory: string;
      noticeBuyoutMinor: string;
      leaveEncashmentGrossMinor: string;
      gratuityGrossMinor: string;
      retrenchmentCompMinor: string;
      vrsCompMinor: string;
      arrearsMinor: string;
      lastDrawnWagesMinor: string;
      completedYears: number;
      avgSalaryLast10MonthsMinor: string;
      leaveBalanceDays: number;
      priorLeaveEncashExemptionMinor: string;
      remainingMonthsToRetirement: number;
      taxRegime: "old" | "new";
      salaryYtdMinor: string;
      tdsYtdMinor: string;
      deductions80cMinor: string;
      deductions80dMinor: string;
      otherDeductionsMinor: string;
      fyStartYear: number;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Load exemption ceilings for the FY
      const ceilings = await tx
        .select()
        .from(exemptionCeilings)
        .where(eq(exemptionCeilings.fyStartYear, p.fyStartYear));

      const ceilingMap = new Map(ceilings.map((c) => [c.section, c.ceilingMinor]));

      const input: FnfInput = {
        employeeId: p.employeeId,
        tenantId: p.tenantId ?? msg.tenantId,
        separationType: p.separationType as FnfInput["separationType"],
        separationDate: p.separationDate,
        employeeCategory: p.employeeCategory as FnfInput["employeeCategory"],
        noticeBuyoutMinor: BigInt(p.noticeBuyoutMinor ?? "0"),
        leaveEncashmentGrossMinor: BigInt(p.leaveEncashmentGrossMinor ?? "0"),
        gratuityGrossMinor: BigInt(p.gratuityGrossMinor ?? "0"),
        retrenchmentCompMinor: BigInt(p.retrenchmentCompMinor ?? "0"),
        vrsCompMinor: BigInt(p.vrsCompMinor ?? "0"),
        arrearsMinor: BigInt(p.arrearsMinor ?? "0"),
        lastDrawnWagesMinor: BigInt(p.lastDrawnWagesMinor ?? "0"),
        completedYears: p.completedYears,
        avgSalaryLast10MonthsMinor: BigInt(p.avgSalaryLast10MonthsMinor ?? "0"),
        leaveBalanceDays: p.leaveBalanceDays ?? 0,
        priorLeaveEncashExemptionMinor: BigInt(p.priorLeaveEncashExemptionMinor ?? "0"),
        remainingMonthsToRetirement: p.remainingMonthsToRetirement ?? 0,
        taxRegime: p.taxRegime,
        salaryYtdMinor: BigInt(p.salaryYtdMinor ?? "0"),
        tdsYtdMinor: BigInt(p.tdsYtdMinor ?? "0"),
        deductions80cMinor: BigInt(p.deductions80cMinor ?? "0"),
        deductions80dMinor: BigInt(p.deductions80dMinor ?? "0"),
        otherDeductionsMinor: BigInt(p.otherDeductionsMinor ?? "0"),
        fyStartYear: p.fyStartYear,
        // Use DB ceilings, fallback to statutory defaults (in paise)
        gratuityCeilingMinor: ceilingMap.get("10_10") ?? 2000000000n,
        leaveEncashCeilingMinor: ceilingMap.get("10_10AA") ?? 2500000000n,
        retrenchmentCeilingMinor: ceilingMap.get("10_10B") ?? 500000000n,
        vrsCeilingMinor: ceilingMap.get("10_10C") ?? 500000000n,
      };

      const result = computeFnfSettlement(input);

      const settlementId = randomUUID();

      await tx.insert(fnfSettlements).values({
        id: settlementId,
        tenantId: msg.tenantId,
        employeeId: p.employeeId,
        separationType: p.separationType,
        separationDate: p.separationDate,
        employeeCategory: p.employeeCategory,
        noticeBuyoutMinor: input.noticeBuyoutMinor,
        leaveEncashmentGrossMinor: input.leaveEncashmentGrossMinor,
        gratuityGrossMinor: input.gratuityGrossMinor,
        retrenchmentCompMinor: input.retrenchmentCompMinor,
        vrsCompMinor: input.vrsCompMinor,
        arrearsMinor: input.arrearsMinor,
        gratuityExemptMinor: result.gratuityExemption.exemptMinor,
        leaveEncashExemptMinor: result.leaveEncashExemption.exemptMinor,
        retrenchmentExemptMinor: result.retrenchmentExemption?.exemptMinor ?? 0n,
        vrsExemptMinor: result.vrsExemption?.exemptMinor ?? 0n,
        totalTaxableMinor: result.totalTaxableOnSeparationMinor,
        tdsOnSeparationMinor: result.tdsOnSeparationMinor,
        netPayableMinor: result.netPayableMinor,
        computationDetail: {
          annualTaxableMinor: result.annualTaxableMinor.toString(),
          annualTaxMinor: result.annualTaxMinor.toString(),
          tdsAlreadyDeductedMinor: result.tdsAlreadyDeductedMinor.toString(),
          totalGrossMinor: result.totalGrossMinor.toString(),
          totalExemptMinor: result.totalExemptMinor.toString(),
        },
        status: "draft",
        currency: "INR",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      // Emit fnfComputed event
      await enqueue(tx, {
        topic: EVENTS.fnfComputed,
        eventType: EVENTS.fnfComputed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          settlementId,
          employeeId: p.employeeId,
          separationType: p.separationType,
          netPayableMinor: result.netPayableMinor.toString(),
          tdsOnSeparationMinor: result.tdsOnSeparationMinor.toString(),
        },
      });

      // Audit event
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "payroll",
          action: "fnf_compute",
          resourceType: "fnf_settlement",
          resourceId: settlementId,
          outcome: "success",
        },
      });
    });
  });
}
