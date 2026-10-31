import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../../topics.js";
import * as auditRepo from "../audit/repo.js";
import * as pfmsRepo from "../pfms/repo.js";
import { checkBatchSendable } from "../pfms/consumer.js";
import { isProductionDeployment } from "../pfms/dsc-client.js";
import * as paymentsRepo from "../payments/repo.js";
import { normalisePoNumber } from "../payments/domain.js";
import { minorString } from "@civitasone/schemas/money";
import { pino } from "pino";
import type { BankFileRow } from "./bank-file-generator.js";
import { sendNachFile } from "./nach-release.js";

const AUDIT_TOPIC = "audit.event.record";
const log = pino({ name: "finance:integration-consumer" });

/**
 * Expense head CODE for the AP bill drafted from an accepted GRN. Resolved per tenant (finance.bill.create looks it
 * up in the bill tenant's own chart of accounts). Default 2202 is the head the old literal id pointed at.
 */
export function grnBillHeadCode(): string {
  const configured = process.env.FINANCE_GRN_BILL_HEAD_CODE?.trim();
  return configured ? configured : "2202";
}

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
    const pfmsBatchId = randomUUID();
    const batchType = p.payrollRunId ? "salary" : p.disbursementId ? "grant" : "scheme";
    const resourceId = p.payrollRunId ?? p.disbursementId ?? p.pfmsTxnId;

    // TX-007: every DB write (idempotency mark, tenant-config read, the batch
    // row, the audit record) commits in ONE
    // transaction, same as every other handler in this file -- the batch is
    // always inserted with submissionStatus "pending" here. The NACH file
    // write + SFTP egress below run AFTER this transaction commits, never
    // while a DB connection/transaction is held open, so a slow or hanging
    // PFMS SFTP gateway can no longer extend a lock hold time, risk a
    // transaction timeout, or starve the pool under load. If the upload
    // succeeds, a separate follow-up write flips the row to "file_sent"; if
    // it fails, the row is left "pending" for manual/scheduled retry -- the
    // batch/audit/event records are never lost, since they already committed.
    const prepared = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return null;
      // Tx-scoped read: this handler already holds an open db.transaction, so
      // the scopedRead-based getTenantConfig must not be called here -- see
      // getTenantConfigTx's doc comment (pfms/repo.ts) for the pool-
      // exhaustion deadlock this avoids on the EFT-initiation path.
      const cfg = await pfmsRepo.getTenantConfigTx(tx, msg.tenantId);
      const agencyCode = (p.agencyCode ?? cfg?.agencyCode ?? "AG001").toUpperCase();
      const ddoCode = (p.ddoCode ?? cfg?.defaultDdo ?? "DDO123456").toUpperCase();
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
        // finance_pfms_status_check allows pending|submitted|accepted|rejected|failed ("initiated" is a payments.finance_payments
        // state and made this insert fail on every real database).
        status: "pending",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      // V4-D-01: finance.payment.made is NOT enqueued here. Grant disbursements and payroll slips treat it as "the
      // money moved", but at this point the batch is only "pending" -- the file has not been sent. It is emitted below,
      // atomically with the file_sent update, once the bank file has actually been handed to the PFMS gateway.
      await audit(tx, msg, "eft_disbursement", "payment", resourceId);
      return { agencyCode };
    });
    if (!prepared) return;

    // GAP-FINANCE-PFMS-01: in production an unsigned (or mock/unverifiable) batch is never released to the PFMS
    // gateway. The batch stays "pending" and the refusal is audited; it is released only after a real DSC signature
    // is on record and verifies. Outside production this is a no-op, so sandbox flows are unchanged.
    if (isProductionDeployment()) {
      const batchRow = await pfmsRepo.findPfmsById(pfmsBatchId, msg.tenantId);
      const sendable = batchRow
        ? await checkBatchSendable(batchRow)
        : { ok: false as const, code: "NOT_FOUND", message: "batch row not found" };
      if (!sendable.ok) {
        await db.transaction(async (tx3) => {
          await enqueue(tx3, {
            topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: {
              service: "finance", action: "send_blocked", resourceType: "pfms_batch", resourceId: pfmsBatchId,
              outcome: "denied", details: { code: sendable.code, message: sendable.message },
            },
          });
        });
        log.warn({ pfmsBatchId, code: sendable.code }, "PFMS file egress blocked: batch not DSC-signed");
        return;
      }
    }

    // ── NACH file generation + SFTP egress — OUTSIDE the DB transaction ─────
    // Resolve real beneficiaries for this PFMS batch (may be empty on first
    // insert since payments rows are linked later; we build from payload).
    const nachRow: BankFileRow = {
      ifsc: p.beneficiaryBankRef?.split(":")[0] ?? "",
      accountNo: p.beneficiaryBankRef?.split(":")[1] ?? "",
      accountName: prepared.agencyCode,
      amountMinor: BigInt(p.amountMinor),
      narration: `${p.mode}/${p.pfmsTxnId}`.slice(0, 25),
      paymentDate: new Date().toISOString().slice(0, 10),
    };
    // Upload to SFTP gateway — skipped silently if SFTP_HOST is not set. No DB
    // transaction is open while this network call runs (TX-007): a slow or
    // hanging PFMS gateway can no longer hold a connection/lock or exhaust
    // the pool. The generate + write + upload + cleanup steps are the shared
    // sendNachFile path (also used by the signed-batch release).
    const uploaded = await sendNachFile({ pfmsBatchId, agencyCode: prepared.agencyCode, rows: [nachRow] })
      // No SFTP gateway configured = nothing was sent. Only a sandbox deployment may treat that as sent.
      .then((remotePath) => remotePath !== null || !isProductionDeployment())
      .catch((err: unknown) => {
        log.error({ err, pfmsBatchId }, "SFTP upload failed — batch remains in pending state");
        // Do not rethrow: let the batch stay pending for manual retry.
        return false;
      });

    // Record the upload outcome in its own follow-up write, separate from the
    // transaction above -- this is the only DB write that ever runs after the
    // SFTP call, and it is a fresh transaction, not the original one held open.
    if (uploaded) {
      await db.transaction(async (tx2) => {
        await pfmsRepo.updatePfmsBatch(tx2, pfmsBatchId, { submissionStatus: "file_sent" });
        // V4-D-01: the success event follows actual egress, in the same transaction as the file_sent write. A batch that
        // was blocked (unsigned in production) or whose upload failed stays "pending" and emits nothing, so downstream
        // services never mark beneficiaries paid for a file that was never sent.
        await enqueue(tx2, {
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
      });
    }
  }, { visibilityTimeout: 300 });

  /** procurement.grn.accepted → draft vendor bill with PO/GRN refs for 3-way match */
  queue.subscribe(CONSUMED_EVENTS.grnAccepted, async (msg) => {
    const p = msg.payload as {
      grnId: string; poRef: string; poNo?: string; vendorId: string; grossMinor?: string | number;
      poAmountMinor?: string; grnAmountMinor?: string;
    };
    const billId = randomUUID();
    // Bug fix: this used to unconditionally template-literal-wrap p.poRef
    // (`procurement_po:${p.poRef}`) even when p.poRef was falsy/missing, so a
    // producer-side gap silently manufactured the literal, UI-visible string
    // "procurement_po:undefined" instead of leaving the bill genuinely
    // unlinked. A missing poRef is now left undefined -- billCreate below
    // already does `poRef: p.poRef ?? null` (payments/consumer.ts), and the
    // Bills UI already renders a null poRef as an honest "—", so there is
    // no need to fabricate a ref that looks real but resolves to nothing.
    //
    // Independent review (PR #1478) found a real gap in the first version of
    // this guard: it only checked p.poRef for JS falsiness, which does NOT
    // catch a producer that has already stringified an undefined id -- the
    // literal, non-empty, TRUTHY string "undefined" (e.g. from a `${someId}`
    // interpolation upstream, or a stray String(x) call) would still sail
    // through `p.poRef ? ... : undefined` and rebuild the exact same bad
    // "procurement_po:undefined" text this fix exists to prevent. This is
    // in fact the most plausible real trigger for how the 5 historical bad
    // rows this PR backfilled ever got that value in the first place. Now
    // rejects that shape too, not just an absent/empty poRef.
    const hasRealPoRef = Boolean(p.poRef) && p.poRef !== "undefined" && p.poRef !== "null";
    const poRef = hasRealPoRef ? (p.poRef.startsWith("procurement_") ? p.poRef : `procurement_po:${p.poRef}`) : undefined;
    const grnRef = `procurement_grn:${p.grnId}`;
    // GAP-FINANCE-EXPENDITURE-BILLS-06: the human PO number rides with a real poRef only (never a number without its
    // link); billCreate normalises it again before it is stored.
    const poNumber = poRef ? normalisePoNumber(p.poNo) : null;
    // R5: authoritative ordered (PO) and accepted (GRN) values derived in
    // procurement. The vendor bill is drafted for the GRN-accepted value (pay
    // for what was received), falling back to legacy grossMinor when the
    // producer did not send the explicit legs.
    const poAmountMinor = p.poAmountMinor != null ? BigInt(p.poAmountMinor) : null;
    const grnAmountMinor = p.grnAmountMinor != null ? BigInt(p.grnAmountMinor) : null;
    // R7: keep money as bigint and transport as a string — never downcast paise
    // to a JS number at the queue boundary.
    const grossBig = grnAmountMinor ?? BigInt(p.grossMinor ?? 0);
    // UAT b10 F94: the AP bill head is a CODE resolved in THIS tenant's chart by finance.bill.create, never a
    // literal head id (the old default dddddddd-0001-... belongs to one tenant, so every other tenant got UNKNOWN_HEAD).
    const headCode = grnBillHeadCode();
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Persist the AP three-way-match read-model so a later invoice citing this
      // GRN can be reconciled even if entered manually.
      // poRef must be resolved (see above) before this AP three-way-match
      // read-model row is persisted -- finance_grn_match.po_ref is NOT NULL,
      // and a manufactured "procurement_po:undefined" value used to satisfy
      // that constraint with a ref that could never actually match a real PO.
      if (poRef && poAmountMinor != null && grnAmountMinor != null) {
        await paymentsRepo.upsertGrnMatch(tx as unknown as Parameters<typeof paymentsRepo.upsertGrnMatch>[0], {
          tenantId: msg.tenantId, grnRef, poRef, vendorId: p.vendorId,
          poAmountMinor, grnAmountMinor,
        });
      }
      await enqueue(tx, {
        topic: COMMANDS.billCreate, eventType: COMMANDS.billCreate,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: billId,
          tenantId: msg.tenantId,
          billNo: `BILL/GRN/${p.grnId.slice(0, 8).toUpperCase()}`,
          vendorId: p.vendorId,
          headCode,
          grossMinor: minorString(grossBig),
          currency: "INR",
          deductions: [],
          netMinor: minorString(grossBig),
          poRef,
          ...(poNumber ? { poNumber } : {}),
          grnRef,
          ...(poAmountMinor != null ? { poAmountMinor: poAmountMinor.toString() } : {}),
          ...(grnAmountMinor != null ? { grnAmountMinor: grnAmountMinor.toString() } : {}),
        },
      });
      // Three-way match advisory notification (merged from payments/grnAccepted)
      if (poAmountMinor != null && grnAmountMinor != null) {
        const THREE_WAY_TOLERANCE_PCT = 5;
        const deviationMinor = grossBig > poAmountMinor ? grossBig - poAmountMinor : poAmountMinor - grossBig;
        // Deviation as a PERCENTAGE ratio (not money): exact bigint basis points, then a
        // small integer to a float percent for the tolerance comparison.
        const deviationBps = poAmountMinor > 0n ? deviationMinor * 10000n / poAmountMinor : 0n;
        const variance = poAmountMinor > 0n
          ? Number(deviationBps) / 100
          : (grossBig > 0n ? Number.POSITIVE_INFINITY : 0);
        const matched = variance <= THREE_WAY_TOLERANCE_PCT;
        await enqueue(tx, {
          topic: matched ? "procurement.three_way_match.passed" : "procurement.three_way_match.failed",
          eventType: matched ? "procurement.three_way_match.passed" : "procurement.three_way_match.failed",
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            grnId: p.grnId, billId, vendorId: p.vendorId,
            poAmountMinor: poAmountMinor.toString(),
            grnAmountMinor: grossBig.toString(),
            variancePct: variance,
            ...(matched ? {} : { reason: `Amount variance ${variance.toFixed(2)}% exceeds ${THREE_WAY_TOLERANCE_PCT}% tolerance` }),
          },
        });
      }
      await audit(tx, msg, "grn_bill_draft", "bill", billId);
    });
  });

  /** payroll.run.approved → post salary GL accrual journal */
  queue.subscribe(CONSUMED_EVENTS.payrollRunApproved, async (msg) => {
    const p = msg.payload as {
      runId: string; month: string; totalGrossMinor: string; totalNetMinor: string;
      totalEmployerContribMinor?: string;
      legalEntityId?: string;
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
          ...(p.legalEntityId ? { legalEntityId: p.legalEntityId } : {}),
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

  /**
   * audit-service → finance: flag recoverable amount in finance audit paras register.
   *
   * The para enters the register as open -- the entry state of the finance respond / escalate / settle
   * workflow (audit/commands.ts) and the only value the status CHECK (migrations/0036) allows for a new
   * para; pending_recovery is audit-services vocabulary, not the registers. The recoverable amount is
   * money_value_minor. para_no carries the full audit-service paraId (an 8-char prefix could collide on
   * (tenant_id, para_no)) and the insert is a no-op on conflict, so a redelivery of the same para under a
   * new messageId cannot unique-violate into a retry / DLQ loop.
   */
  queue.subscribe(CONSUMED_EVENTS.auditParaPendingRecovery, async (msg) => {
    const p = msg.payload as {
      paraId: string; deptRef: string; amountInvolvedMinor: number | string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const inserted = await auditRepo.insertAuditParaIfAbsent(tx, {
        id: randomUUID(), tenantId: msg.tenantId,
        paraNo: `AUDIT-${p.paraId}`,
        source: "internal", dept: p.deptRef,
        moneyValueMinor: BigInt(p.amountInvolvedMinor),
        currency: "INR", status: "open",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (!inserted) return;
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
