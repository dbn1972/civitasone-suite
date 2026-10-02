/**
 * F&F Settlement consumer — processes payroll.fnf.compute commands.
 *
 * Flow: markProcessed → load ceilings → computeFnfSettlement → persist → emit events → audit.
 *
 * Also processes payroll.fnf.transition (GAP-PAYROLL-FNF-01): submit /
 * finance-approve / disburse / reject, re-checked under a row lock with the
 * same rules the route applied (./workflow.ts).
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { fnfSettlements, exemptionCeilings } from "./schema.js";
import { computeFnfSettlement, type FnfInput } from "./domain.js";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { decideTransition, type FnfAction } from "./workflow.js";

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
      /** GAP-PAYROLL-FNF-03: record-derived inputs the clerk overrode, with the reason. */
      overrides?: { fields: string[]; reason: string };
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
      // The computed figures, shared by the INSERT below and by the
      // recompute-after-rejection UPDATE (GAP-PAYROLL-FNF-01).
      const figures = {
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
          ...(p.overrides ? { overrides: p.overrides } : {}),
        },
      };

      const [inserted] = await tx.insert(fnfSettlements).values({
        id: settlementId,
        tenantId: msg.tenantId,
        employeeId: p.employeeId,
        ...figures,
        // GAP-PAYROLL-FNF-01: a freshly computed settlement is 'computed'
        // (it used to be written as 'draft'; workflow.ts treats both as
        // submittable). computed_by feeds the finance-approve
        // segregation-of-duties check.
        status: "computed",
        currency: "INR",
        computedBy: msg.actorId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      })
        .onConflictDoNothing({
          target: [fnfSettlements.tenantId, fnfSettlements.employeeId, fnfSettlements.separationDate],
        })
        .returning({ id: fnfSettlements.id });

      let resolvedId = inserted?.id;
      let recomputed = false;
      if (!inserted) {
        // GAP-PAYROLL-FNF-01: a REJECTED settlement is sent back to the
        // payroll desk to be recomputed -- the unique index means that can
        // only happen in place. The status predicate makes this atomic: only
        // a row that is still 'rejected' is reopened (to 'computed', version
        // bumped, previous submit/approval/rejection cleared); any other existing row
        // is left untouched, exactly as before.
        const [reopened] = await tx.update(fnfSettlements)
          .set({
            ...figures,
            status: "computed",
            computedBy: msg.actorId,
            updatedBy: msg.actorId,
            updatedAt: new Date(),
            version: sql`${fnfSettlements.version} + 1`,
            submittedBy: null,
            submittedAt: null,
            financeApprovedBy: null,
            financeApprovedAt: null,
            // The rejection is resolved by this recompute; its who/why stays
            // in the fnf_reject audit row, not on the live settlement.
            rejectedBy: null,
            rejectedAt: null,
            rejectionReason: null,
          })
          .where(and(
            eq(fnfSettlements.tenantId, msg.tenantId),
            eq(fnfSettlements.employeeId, p.employeeId),
            eq(fnfSettlements.separationDate, p.separationDate),
            eq(fnfSettlements.status, "rejected"),
          ))
          .returning({ id: fnfSettlements.id });
        if (reopened) {
          resolvedId = reopened.id;
          recomputed = true;
        }
      }

      if (!resolvedId) {
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
          settlementId: resolvedId,
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
          action: recomputed ? "fnf_recompute" : "fnf_compute",
          resourceType: "fnf_settlement",
          resourceId: resolvedId,
          outcome: "success",
          ...(recomputed ? { oldValue: { status: "rejected" }, newValue: { status: "computed" } } : {}),
          ...(p.overrides ? { metadata: { overriddenFields: p.overrides.fields, overrideReason: p.overrides.reason } } : {}),
        },
      });
    });
  });

  // GAP-PAYROLL-FNF-01: submit / finance-approve / disburse / reject.
  // The route already answered 403/409 to every caller it could see; this
  // re-asserts status, version and segregation of duties under a row lock
  // (same as #1761's off-cycle process), and the UPDATE repeats the
  // status+version predicate, so two racing approvals, a replay or a stale
  // double-click can transition the row at most once. Losers are a silent
  // no-op: no write, no audit.
  queue.subscribe(COMMANDS.fnfTransition, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; action: FnfAction; expectedVersion: number;
      note?: string; reason?: string; paymentReference?: string; paymentDate?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const locked = (await tx.execute(sql`
        SELECT status, version, created_by, computed_by, submitted_by, finance_approved_by
          FROM payroll.fnf_settlements
         WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid
         FOR UPDATE
      `)) as unknown as Array<{
        status: string; version: number; created_by: string; computed_by: string | null;
        submitted_by: string | null; finance_approved_by: string | null;
      }>;
      const row = locked[0];
      if (!row) return;
      const decision = decideTransition(p.action, {
        status: row.status,
        version: Number(row.version),
        createdBy: row.created_by,
        computedBy: row.computed_by,
        submittedBy: row.submitted_by,
        financeApprovedBy: row.finance_approved_by,
      }, { id: msg.actorId }, p.expectedVersion);
      if (!decision.ok) return;
      if (p.action === "reject" && !p.reason) return;
      if (p.action === "disburse" && (!p.paymentReference || !p.paymentDate)) return;

      const actor = sql`${msg.actorId}::uuid`;
      const stamp =
        p.action === "submit" ? sql`submitted_by = ${actor}, submitted_at = NOW()`
        : p.action === "finance-approve" ? sql`finance_approved_by = ${actor}, finance_approved_at = NOW()`
        : p.action === "disburse" ? sql`disbursed_by = ${actor}, disbursed_at = NOW(),
            payment_reference = ${p.paymentReference ?? null}, payment_date = ${p.paymentDate ?? null}::date`
        : sql`rejected_by = ${actor}, rejected_at = NOW(), rejection_reason = ${p.reason ?? null}`;

      const updated = (await tx.execute(sql`
        UPDATE payroll.fnf_settlements
           SET status = ${decision.to}, version = version + 1,
               updated_by = ${actor}, updated_at = NOW(), ${stamp}
         WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid
           AND status = ${decision.from} AND version = ${p.expectedVersion}
        RETURNING version, employee_id, net_payable_minor
      `)) as unknown as Array<{ version: number; employee_id: string; net_payable_minor: string }>;
      const after = updated[0];
      if (!after) return;

      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "payroll",
          action: `fnf_${p.action.replace("-", "_")}`,
          resourceType: "fnf_settlement",
          resourceId: p.id,
          outcome: "success",
          ...(p.reason ? { reason: p.reason } : {}),
          ...(p.note ? { note: p.note } : {}),
          oldValue: { status: decision.from, version: p.expectedVersion },
          newValue: {
            status: decision.to,
            version: Number(after.version),
            ...(p.action === "disburse"
              ? { paymentReference: p.paymentReference, paymentDate: p.paymentDate, netPayableMinor: String(after.net_payable_minor) }
              : {}),
          },
        },
      });
    });
  });
}
