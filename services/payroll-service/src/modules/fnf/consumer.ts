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
      // DIC engagement terminal-benefit gates (default true when absent).
      eligibleForGratuity?: boolean;
      leaveEncashmentEligible?: boolean;
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
        ...(p.eligibleForGratuity != null ? { eligibleForGratuity: p.eligibleForGratuity } : {}),
        ...(p.leaveEncashmentEligible != null ? { leaveEncashmentEligible: p.leaveEncashmentEligible } : {}),
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
        // Use DB ceilings, fallback to statutory defaults, in paise (₹1L =
        // ₹1,00,000; paise = rupees × 100). Previously 10x too high
        // (2000000000n etc.) -- see migration
        // 0048_fix_fnf_exemption_ceilings_10x.sql for the full writeup;
        // these MUST always match that migration's corrected seed values
        // exactly.
        gratuityCeilingMinor: ceilingMap.get("10_10") ?? 200000000n,     // ₹20L
        leaveEncashCeilingMinor: ceilingMap.get("10_10AA") ?? 250000000n, // ₹25L
        retrenchmentCeilingMinor: ceilingMap.get("10_10B") ?? 50000000n,  // ₹5L
        vrsCeilingMinor: ceilingMap.get("10_10C") ?? 50000000n,           // ₹5L
      };

      const result = computeFnfSettlement(input);

      const settlementId = randomUUID();

      // HIGH fix (defense in depth): payroll.fnf_settlements now carries a
      // unique (tenant_id, employee_id, separation_date) index (migrations/
      // 0044_fnf_settlements_unique.sql, widened by
      // 0045_fnf_settlements_unique_with_date.sql) guarding against two
      // settlement rows for the same exit -- reachable both via a
      // retried/duplicated hrms.employee.separated event (the main path,
      // closed at the source by hrms-service's separateEmployee messageId
      // fix) and via POST /v1/payroll/fnf/compute (fnf/routes.ts) being
      // called twice directly, which that source-side fix cannot reach.
      // separation_date is part of the key (not just tenant_id+employee_id)
      // because an employee CAN legitimately be separated more than once
      // (separate -> reinstate -> separate again, each with its own
      // separationDate) -- see separateEmployee()'s messageId, keyed on
      // `employeeId:effectiveDate` for exactly that reason. A 2-column key
      // silently dropped the second, legitimate settlement outright.
      // onConflictDoNothing + the empty-`inserted` check below makes THIS
      // command idempotent under that constraint too, instead of letting
      // the insert throw an unhandled 23505 that would roll back
      // markProcessed and retry forever (a poison message).
      const [inserted] = await tx.insert(fnfSettlements).values({
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
      })
        .onConflictDoNothing({
          target: [fnfSettlements.tenantId, fnfSettlements.employeeId, fnfSettlements.separationDate],
        })
        .returning({ id: fnfSettlements.id });

      if (!inserted) {
        // A settlement for this employee AND separation_date already exists
        // -- a true duplicate compute request (retry / redelivery /
        // double-click / a second caller for the SAME exit). A settlement
        // for the same employee with a DIFFERENT separation_date (a later,
        // genuinely separate exit -- e.g. reinstated then separated again)
        // is not a conflict at all and inserts normally above. The original
        // computation stands; skip emitting a second fnfComputed event and a
        // second audit row for what is, from the ledger's point of view, the
        // same settlement.
        return;
      }

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
