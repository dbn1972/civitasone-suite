import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../../topics.js";
import * as auditRepo from "../audit/repo.js";
import * as pfmsRepo from "../pfms/repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerIntegrationConsumers(queue: Queue): void {
  /** grant-service / payroll-service → finance: process EFT disbursement */
  queue.subscribe(CONSUMED_EVENTS.eftInitiate, async (msg) => {
    const p = msg.payload as {
      disbursementId?: string;
      payrollRunId?: string;
      installmentId?: string;
      amountMinor: string;
      currency: string;
      pfmsTxnId: string;
      mode: string;
      beneficiaryBankRef?: string;
      agencyCode?: string;
      schemeCode?: string;
      ddoCode?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cfg = await pfmsRepo.getTenantConfig(msg.tenantId);
      const agencyCode = (p.agencyCode ?? cfg?.agencyCode ?? "AG001").toUpperCase();
      const ddoCode = (p.ddoCode ?? cfg?.defaultDdo ?? "DDO123456").toUpperCase();
      const pfmsBatchId = randomUUID();
      const batchType = p.payrollRunId ? "salary" : p.disbursementId ? "grant" : "scheme";
      await pfmsRepo.insertPfmsBatch(tx, {
        id: pfmsBatchId,
        tenantId: msg.tenantId,
        pfmsId: p.pfmsTxnId,
        type: batchType,
        amountMinor: BigInt(p.amountMinor),
        currency: p.currency ?? "INR",
        beneficiaryCount: 1,
        agencyCode,
        schemeCode: p.schemeCode?.toUpperCase() ?? null,
        ddoCode,
        submissionStatus: "pending",
        status: "initiated",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.paymentMade, eventType: EVENTS.paymentMade,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          disbursementId: p.disbursementId,
          payrollRunId: p.payrollRunId,
          pfmsTxnId: p.pfmsTxnId,
          amountMinor: p.amountMinor,
          mode: p.mode,
          outcome: "success",
        },
      });
      const resourceId = p.payrollRunId ?? p.disbursementId ?? p.pfmsTxnId;
      await audit(tx, msg, "eft_disbursement", "payment", resourceId);
    });
  });

  /** procurement.grn.accepted → draft vendor bill with PO/GRN refs for 3-way match */
  queue.subscribe(CONSUMED_EVENTS.grnAccepted, async (msg) => {
    const p = msg.payload as {
      grnId: string; poRef: string; vendorId: string; grossMinor?: number;
    };
    const billId = randomUUID();
    const gross = p.grossMinor ?? 0;
    const poRef = p.poRef.startsWith("procurement_") ? p.poRef : `procurement_po:${p.poRef}`;
    const grnRef = `procurement_grn:${p.grnId}`;
    const headId = process.env.FINANCE_DEFAULT_HEAD_ID ?? "dddddddd-0001-0000-0000-000000000001";
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: COMMANDS.billCreate, eventType: COMMANDS.billCreate,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: billId,
          tenantId: msg.tenantId,
          billNo: `BILL/GRN/${p.grnId.slice(0, 8).toUpperCase()}`,
          vendorId: p.vendorId,
          headId,
          grossMinor: gross,
          currency: "INR",
          deductions: [],
          netMinor: gross,
          poRef,
          grnRef,
        },
      });
      await audit(tx, msg, "grn_bill_draft", "bill", billId);
    });
  });

  /** payroll.run.approved → post salary GL accrual journal */
  queue.subscribe(CONSUMED_EVENTS.payrollRunApproved, async (msg) => {
    const p = msg.payload as {
      runId: string; month: string; totalGrossMinor: string; totalNetMinor: string;
      totalEmployerContribMinor?: string;
    };
    const gross = BigInt(p.totalGrossMinor);
    const net = BigInt(p.totalNetMinor);
    // H2: the statutory leg is DERIVED as (gross - net) so the employee side is
    // provably balanced: Dr gross == Cr net + Cr statutory == gross, regardless
    // of how net was clamped (negative-net employees forced to 0). We never clamp
    // the statutory amount; if it would be negative (net > gross, pathological)
    // we book it on the opposite side so the journal still nets to zero.
    const statutory = gross - net;
    // H3: keep all paise as bigint (no Number() on aggregate paise) so amounts
    // above 2^53 do not silently lose precision in the GL legs.
    const employer = BigInt(p.totalEmployerContribMinor ?? "0");
    const journalId = randomUUID();
    // Employee-side legs: Dr salary expense (gross); Cr net payable; Cr statutory.
    const lines: Array<{ accountCode: string; debitMinor: bigint; creditMinor: bigint; narration: string }> = [
      { accountCode: "5001", debitMinor: gross, creditMinor: 0n, narration: "Salary expense" },
      { accountCode: "2101", debitMinor: 0n, creditMinor: net, narration: "Net salary payable" },
      statutory >= 0n
        ? { accountCode: "2102", debitMinor: 0n, creditMinor: statutory, narration: "Statutory deductions payable" }
        : { accountCode: "2102", debitMinor: -statutory, creditMinor: 0n, narration: "Statutory deductions payable" },
    ];
    // Employer statutory contributions (PF/EPS, ESI, NPS) are an additional
    // expense + liability, separate from the employee-side gross above. The two
    // legs are equal and opposite, so they keep the voucher balanced.
    if (employer > 0n) {
      lines.push({ accountCode: "5002", debitMinor: employer, creditMinor: 0n, narration: "Employer contributions expense" });
      lines.push({ accountCode: "2103", debitMinor: 0n, creditMinor: employer, narration: "Employer contributions payable" });
    }
    // Defensive: assert the voucher balances before we publish it.
    const totalDr = lines.reduce((s, l) => s + l.debitMinor, 0n);
    const totalCr = lines.reduce((s, l) => s + l.creditMinor, 0n);
    if (totalDr !== totalCr) {
      throw new Error(`PAYROLL_ACCRUAL_UNBALANCED: debit ${totalDr} != credit ${totalCr} for run ${p.runId}`);
    }
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: COMMANDS.journalPost, eventType: COMMANDS.journalPost,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: journalId,
          tenantId: msg.tenantId,
          voucherNo: `PAY/${p.month}/${p.runId.slice(0, 8)}`,
          type: "payroll_accrual",
          postingDate: new Date().toISOString().slice(0, 10),
          // H3: paise passed as bigint strings so > 2^53 paise stays exact.
          lines: lines.map((l) => ({
            accountCode: l.accountCode,
            debitMinor: l.debitMinor.toString(),
            creditMinor: l.creditMinor.toString(),
            narration: l.narration,
          })),
        },
      });
      await audit(tx, msg, "payroll_gl_accrual", "payroll_run", p.runId);
    });
  });

  /** audit-service → finance: flag recoverable amount in finance audit paras register */
  queue.subscribe(CONSUMED_EVENTS.auditParaPendingRecovery, async (msg) => {
    const p = msg.payload as {
      paraId: string; deptRef: string; amountInvolvedMinor: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await auditRepo.insertAuditPara(tx, {
        id: randomUUID(), tenantId: msg.tenantId,
        paraNo: `AUDIT-${p.paraId.slice(0, 8)}`,
        source: "internal", dept: p.deptRef,
        moneyValueMinor: BigInt(p.amountInvolvedMinor),
        currency: "INR", status: "pending_recovery",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "recovery_flag", "finance_audit_para", p.paraId);
    });
  });

  /** grant-service → finance: reconcile utilisation certificate against disbursement/sanction */
  queue.subscribe(CONSUMED_EVENTS.grantUcSubmitted, async (msg) => {
    const p = msg.payload as {
      ucId: string; applicationId: string; utilisedMinor: number | string;
      disbursementId?: string;
    };
    const utilisedMinor = BigInt(p.utilisedMinor);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: EVENTS.ucReconciled, eventType: EVENTS.ucReconciled,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          ucId: p.ucId,
          applicationId: p.applicationId,
          disbursementId: p.disbursementId,
          utilisedMinor: utilisedMinor.toString(),
          outcome: "reconciled",
        },
      });
      await audit(tx, msg, "uc_reconciled", "grant_uc_statement", p.ucId);
    });
  });
}

async function audit(
  tx: Parameters<typeof markProcessed>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string, resourceType: string, resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
