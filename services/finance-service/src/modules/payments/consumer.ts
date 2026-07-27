import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { runWithTenant } from "@civitasone/db";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as budgetRepo from "../budget/repo.js";
import { assertThreeWayMatchPresent, assertThreeWayMatch, assertBillPassed, assertValidPaymentMode, assertDistinctMakerChecker, nextStage, deviationExceedsTolerance, DEFAULT_THREE_WAY_TOLERANCE_PCT } from "./domain.js";
import { minorString } from "@civitasone/schemas/money";
import { assertValidDdoCode } from "../../shared/pfms.js";
import { assertValidHoAWithMaster } from "../hoa/domain.js";
import { ddoExists, paoExists } from "../masters/repo.js";
import * as pfmsRepo from "../pfms/repo.js";
import { getPeriodStatus } from "../period-close/routes.js";
import * as allocRepo from "../budget/allocation-repo.js";
import { fyFromDate, nextDocNo } from "../hoa/voucher.js";
import type { Deduction } from "./schema.js";
import { enqueueSpineJournal } from "../gl/spine.js";
import { postCashBook } from "../../shared/cashbook.js";
import type { JournalLine } from "../gl/schema.js";

const AP_CONTROL_CODE = process.env.FINANCE_AP_CONTROL_CODE ?? "2050";
const BANK_CODE = process.env.FINANCE_BANK_CODE ?? "1100";

/** Resolve a head code to its UUID within the tx; throws if the control head is missing. */
async function headIdByCode(tx: unknown, tenantId: string, code: string, label: string): Promise<string> {
  const head = await budgetRepo.findHeadByCodeTx(tx as Parameters<typeof budgetRepo.findHeadByCodeTx>[0], tenantId, code);
  if (!head) throw new Error(`MISSING_CONTROL_HEAD: ${label} head code ${code} not found for tenant`);
  return head.id;
}

const AUDIT_TOPIC = "audit.event.record";

/**
 * Resolve the 3-way-match tolerance from env.
 *
 * `Number(raw) || undefined` was WRONG on the money path: `FINANCE_THREE_WAY_TOLERANCE_PCT=0`
 * is falsy, so an operator asking for ZERO tolerance silently got the 2% default
 * and overage up to 2% was admitted. Only an unset/blank/non-finite/negative
 * value falls back to the default; 0 is an explicit, valid setting.
 */
function resolveThreeWayTolerancePct(fallbackPct: number = DEFAULT_THREE_WAY_TOLERANCE_PCT): number {
  const raw = process.env.FINANCE_THREE_WAY_TOLERANCE_PCT;
  if (raw == null || raw.trim() === "") return fallbackPct;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallbackPct;
  return parsed;
}

export function registerPaymentsConsumers(queue: Queue): void {
  // Tenant context: every command carries tenantId in its envelope. Wrap each
  // handler in runWithTenant so the db.transaction() GUC (app.tenant_id) is set
  // and FORCE ROW LEVEL SECURITY writes/reads are scoped to the message tenant.
  const sub = <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>): void =>
    queue.subscribe<T>(topic, async (msg) => { await runWithTenant(msg.tenantId, () => handler(msg)); });
  sub(COMMANDS.billCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; billNo: string; vendorId: string; headId: string;
      ddoCode?: string; paoCode?: string;
      sanctionRef?: string; grossMinor: number; currency?: string; deductions: Deduction[];
      netMinor: number; poRef?: string; grnRef?: string; billDate?: string;
      poAmountMinor?: string; grnAmountMinor?: string;
    };
    // B1: when the producer (e.g. grn.accepted integration handler) omits ddoCode,
    // fall back to FINANCE_DEFAULT_DDO_CODE env var, then the tenant PFMS config
    // defaultDdo, then the constant DDO000001 (prevents dead-lettering every GRN bill).
    let resolvedDdoCode = p.ddoCode;
    if (!resolvedDdoCode) {
      const tenantCfg = await pfmsRepo.getTenantConfig(msg.tenantId);
      resolvedDdoCode = process.env.FINANCE_DEFAULT_DDO_CODE ?? tenantCfg?.defaultDdo ?? "DDO000001";
    }
    assertValidDdoCode(resolvedDdoCode);
    const hasMismatch = !p.poRef || !p.grnRef;
    // C3: derive the period from the bill's OWN posting/value date, not wall-clock.
    // The bill carries an optional billDate (YYYY-MM-DD); when absent we fall back
    // to today (the create date), mirroring gl/consumer.ts which uses the document date.
    const billDate = (p.billDate && /^\d{4}-\d{2}-\d{2}$/.test(p.billDate))
      ? p.billDate
      : new Date().toISOString().slice(0, 10);
    const billPeriod = billDate.slice(0, 7);
    const netMinor = BigInt(p.netMinor);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const head = await budgetRepo.findHeadByIdTx(tx, p.headId);
      const reader = tx as unknown as Parameters<typeof ddoExists>[2];
      // M3: a referenced head that does not resolve for this tenant is a hard error,
      // not a silently-skipped control. (headId is always referenced on a bill.)
      if (!head || head.tenantId !== p.tenantId) {
        throw new Error(`UNKNOWN_HEAD: ${p.headId} not found in budget head master for tenant`);
      }
      // HoA: well-formed 18-digit segmentation + major head exists in master
      await assertValidHoAWithMaster(head.hoaCode, reader);
      // DDO/PAO must exist in the per-tenant master (when provided)
      if (!(await ddoExists(p.tenantId, resolvedDdoCode.toUpperCase(), reader))) {
        throw new Error(`UNKNOWN_DDO: ${p.ddoCode} not found in DDO master`);
      }
      if (p.paoCode && !(await paoExists(p.tenantId, p.paoCode.toUpperCase(), reader))) {
        throw new Error(`UNKNOWN_PAO: ${p.paoCode} not found in PAO master`);
      }
      // M3: if a sanction is REFERENCED, it must resolve for this tenant. A bill
      // citing a bogus/other-tenant sanctionRef must NOT bypass the balance check.
      let sanction: Awaited<ReturnType<typeof budgetRepo.findSanctionByIdTx>> = null;
      if (p.sanctionRef) {
        sanction = await budgetRepo.findSanctionByIdTx(tx, p.sanctionRef);
        if (!sanction || sanction.tenantId !== p.tenantId) {
          throw new Error(`UNKNOWN_SANCTION: ${p.sanctionRef} not found for tenant`);
        }
        // R11: a bill may only draw on an APPROVED sanction. A pending/draft
        // sanction (maker-checker not yet completed) cannot fund expenditure.
        if (sanction.status !== "approved") {
          throw new Error(`SANCTION_NOT_APPROVED: ${p.sanctionRef} is '${sanction.status}', must be approved before billing`);
        }
      }
      // Period hard-close: block bill posting into a hard-closed period (bill's own date).
      if ((await getPeriodStatus(p.tenantId, billPeriod)) === "hard_close") {
        throw new Error(`PERIOD_CLOSED: cannot post bill into hard-closed period ${billPeriod}`);
      }
      // Budget appropriation control: locate the head allocation for the bill's FY.
      const billFy = fyFromDate(billDate);
      const alloc = await allocRepo.findAllocationTx(tx, p.tenantId, p.headId, billFy);
      // P1-1: gapless, strictly-sequential bill number from the shared atomic
      // allocator (per tenant+FY+series). The caller-supplied billNo is ignored
      // as the authoritative number; a rolled-back create does not consume one.
      const { docNo: billNo } = await nextDocNo(
        tx as unknown as Parameters<typeof nextDocNo>[0], p.tenantId, billFy, "BILL",
      );
      // R5: resolve authoritative PO + GRN(accepted) amounts for the 3-way match
      // snapshot — prefer the values carried on the command, else fall back to
      // the AP read-model populated from procurement.grn.accepted (keyed by grnRef).
      let poAmountMinor: bigint | null = p.poAmountMinor != null ? BigInt(p.poAmountMinor) : null;
      let grnAmountMinor: bigint | null = p.grnAmountMinor != null ? BigInt(p.grnAmountMinor) : null;
      if ((poAmountMinor == null || grnAmountMinor == null) && p.grnRef) {
        const match = await repo.findGrnMatch(tx, p.tenantId, p.grnRef);
        if (match) {
          poAmountMinor = poAmountMinor ?? match.poAmountMinor;
          grnAmountMinor = grnAmountMinor ?? match.grnAmountMinor;
        }
      }
      await repo.insertBill(tx, {
        id: p.id, tenantId: p.tenantId, billNo, vendorId: p.vendorId,
        headId: p.headId, ddoCode: resolvedDdoCode.toUpperCase(),
        ...(p.paoCode ? { paoCode: p.paoCode.toUpperCase() } : {}),
        sanctionRef: p.sanctionRef ?? null,
        grossMinor: BigInt(p.grossMinor), currency: p.currency ?? "INR",
        deductions: p.deductions, netMinor,
        poRef: p.poRef ?? null, grnRef: p.grnRef ?? null,
        ...(poAmountMinor != null ? { poAmountMinor } : {}),
        ...(grnAmountMinor != null ? { grnAmountMinor } : {}),
        billDate,
        stage: "section", status: hasMismatch ? "on_hold" : "pending",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      // C1: register the commitment with a single atomic guarded UPDATE. Two
      // concurrent bills can no longer both pass a stale read — the conditional
      // WHERE serialises them; the loser gets rowcount=0 and is rejected.
      if (alloc) {
        const ok = await allocRepo.addCommittedGuarded(tx, alloc.id, netMinor);
        if (!ok) {
          throw new Error(`OVER_APPROPRIATION: bill ${netMinor} paise exceeds available appropriation for head ${p.headId} (${billFy})`);
        }
      }
      // C2: increment sanction utilised via guarded SQL expression (no read-then-set,
      // no lost update). Loser of a concurrent race gets rowcount=0 → rejected.
      if (sanction) {
        const ok = await budgetRepo.incrementSanctionUtilisedGuarded(tx, sanction.id, netMinor, msg.actorId);
        if (!ok) {
          throw new Error(`SANCTION_EXHAUSTED: bill ${netMinor} paise exceeds sanction balance for ${p.sanctionRef}`);
        }
      }
      if (hasMismatch) {
        await enqueue(tx, {
          topic: EVENTS.billMismatch, eventType: EVENTS.billMismatch,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { billId: p.id, billNo, reason: "missing po_ref or grn_ref" },
        });
      }
      await audit(tx, msg, "create", "bill", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "bill", p.id));
  });

  sub(COMMANDS.billApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; notes?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const bill = await repo.findBillByIdTx(tx, p.id);
      if (!bill) throw new Error(`bill ${p.id} not found`);
      // C4 FIX: Maker-checker on bill approval — the approver must differ from
      // the bill creator. Self-approval of a bill is a segregation-of-duties violation.
      assertDistinctMakerChecker(bill.createdBy, msg.actorId);
      // 3-way match must be valid before passing. When the bill carries the
      // authoritative PO + GRN(accepted) amounts (snapshotted at create or
      // resolved from the AP read-model), enforce the real tri-leg
      // reconciliation: the invoice may not exceed GRN/PO beyond tolerance.
      // Otherwise fall back to the presence check (manual bills with no
      // resolvable procurement amounts).
      let poAmt = bill.poAmountMinor;
      let grnAmt = bill.grnAmountMinor;
      if ((poAmt == null || grnAmt == null) && bill.grnRef) {
        const match = await repo.findGrnMatch(tx, p.tenantId, bill.grnRef);
        if (match) {
          poAmt = poAmt ?? match.poAmountMinor;
          grnAmt = grnAmt ?? match.grnAmountMinor;
        }
      }
      if (poAmt != null && grnAmt != null) {
        const tol = resolveThreeWayTolerancePct();
        assertThreeWayMatch(bill.poRef, bill.grnRef, {
          poAmountMinor: poAmt, grnAmountMinor: grnAmt, invoiceMinor: bill.grossMinor,
        }, tol);
      } else {
        assertThreeWayMatchPresent(bill.poRef, bill.grnRef);
      }
      const currentStage = bill.stage ?? "section";
      const newStage = nextStage(currentStage);
      const isPassed = newStage === "pay";
      await repo.updateBill(tx, p.id, {
        stage: newStage,
        status: isPassed ? "passed" : "pending",
        updatedBy: msg.actorId,
        version: (bill.version ?? 1) + 1,
      });
      if (isPassed) {
        await enqueue(tx, {
          topic: EVENTS.billPassed, eventType: EVENTS.billPassed,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { billId: p.id, vendorId: bill.vendorId, netMinor: bill.netMinor.toString() },
        });
        // GL spine: bill passed -> Dr expense head / Cr Accounts-Payable control.
        const apHeadId = await headIdByCode(tx, p.tenantId, AP_CONTROL_CODE, "accounts_payable");
        const billDate = bill.billDate ?? new Date(bill.createdAt).toISOString().slice(0, 10);
        const lines: JournalLine[] = [
          { accountCode: bill.headId,  debitMinor: bill.netMinor, creditMinor: 0n },
          { accountCode: apHeadId,     debitMinor: 0n,            creditMinor: bill.netMinor },
        ];
        await enqueueSpineJournal(tx, {
          tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          sourceKey: `bill:${p.id}`, type: "bill", postingDate: billDate, lines,
        });
      }
      await audit(tx, msg, "approve", "bill", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "bill", p.id));
  });

  sub(COMMANDS.paymentInitiate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; billId: string; ddoCode: string; mode: string;
      amountMinor: number | string; currency?: string; eftRef?: string; bankAccountId?: string;
    };
    assertValidDdoCode(p.ddoCode);
    const paymentAmount = BigInt(p.amountMinor);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const bill = await repo.findBillByIdTx(tx, p.billId);
      if (!bill) throw new Error(`bill ${p.billId} not found`);
      if (bill.ddoCode && bill.ddoCode !== p.ddoCode.toUpperCase()) {
        throw new Error(`DDO code mismatch: bill has ${bill.ddoCode}, payment has ${p.ddoCode}`);
      }
      assertBillPassed(bill.status ?? "pending");
      assertValidPaymentMode(p.mode);
      // C4 FIX: Maker-checker on payment initiation — the payer must differ
      // from the bill creator. Prevents one actor from creating AND paying a bill.
      assertDistinctMakerChecker(bill.createdBy, msg.actorId);
      // C3 FIX: Payment amount conservation invariant.
      // The payment amount MUST equal the bill's net amount (full payment).
      // Part-payments are not yet supported — reject mismatches to prevent
      // amount divergence between AP settlement, GL posting, and cash book.
      const billNet = BigInt(bill.netMinor);
      if (paymentAmount !== billNet) {
        throw new Error(
          `PAYMENT_AMOUNT_MISMATCH: payment ${paymentAmount} paise does not equal bill net ${billNet} paise. ` +
          `Full payment required (part-payment not yet supported).`,
        );
      }
      // C3: derive the period from the underlying bill's own value/posting date,
      // not wall-clock. Falls back to the bill's create date if no billDate set.
      const payDate = (bill.billDate ?? new Date(bill.createdAt).toISOString().slice(0, 10));
      const payPeriod = payDate.slice(0, 7);
      if ((await getPeriodStatus(p.tenantId, payPeriod)) === "hard_close") {
        throw new Error(`PERIOD_CLOSED: cannot post payment into hard-closed period ${payPeriod}`);
      }
      await repo.insertPayment(tx, {
        id: p.id, tenantId: p.tenantId, billId: p.billId,
        ddoCode: p.ddoCode.toUpperCase(),
        eftRef: p.eftRef ?? null, mode: p.mode,
        amountMinor: BigInt(p.amountMinor), currency: p.currency ?? "INR",
        ...(p.bankAccountId ? { bankAccountId: p.bankAccountId } : {}),
        status: "initiated", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.updateBill(tx, p.billId, { status: "paid", updatedBy: msg.actorId });
      // M2: on payment release, settle the bill's committed appropriation into
      // actual. C1 registered the commitment as the bill's netMinor for the
      // bill's FY allocation; here we drain exactly that amount from committed
      // into actual via an atomic guarded UPDATE (committed_minor >= amount).
      // available = allocated-(committed+actual) is invariant across the move,
      // and the guard makes a redelivered payment a no-op (no double-move).
      const settleFy = fyFromDate(payDate);
      const settleAlloc = await allocRepo.findAllocationTx(tx, p.tenantId, bill.headId, settleFy);
      if (settleAlloc) {
        await allocRepo.settleCommittedToActualGuarded(tx, settleAlloc.id, bill.netMinor);
      }
      await enqueue(tx, {
        topic: EVENTS.paymentMade, eventType: EVENTS.paymentMade,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { paymentId: p.id, billId: p.billId, amountMinor: minorString(p.amountMinor), mode: p.mode },
      });
      // GL spine: payment released -> Dr Accounts-Payable / Cr Bank.
      const payApHeadId = await headIdByCode(tx, p.tenantId, AP_CONTROL_CODE, "accounts_payable");
      const bankHeadId = await headIdByCode(tx, p.tenantId, BANK_CODE, "bank");
      const payAmount = BigInt(p.amountMinor);
      const payLines: JournalLine[] = [
        { accountCode: payApHeadId, debitMinor: payAmount, creditMinor: 0n },
        { accountCode: bankHeadId,  debitMinor: 0n,        creditMinor: payAmount },
      ];
      await enqueueSpineJournal(tx, {
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        sourceKey: `payment:${p.id}`, type: "payment", postingDate: payDate, lines: payLines,
      });
      // P1-2: cash book (IGFRS cash basis) — payment release is cash OUT of bank.
      // Idempotent on (tenant, reference); redelivery is a no-op.
      await postCashBook(tx as unknown as Parameters<typeof postCashBook>[0], {
        tenantId: p.tenantId, entryDate: payDate, voucherType: "payment",
        voucherNo: bill.billNo, particulars: `Payment against bill ${bill.billNo}`,
        receiptMinor: 0n, paymentMinor: payAmount, bankOrCash: "bank",
        reference: `payment:${p.id}`, actorId: msg.actorId,
      });
      await audit(tx, msg, "initiate", "payment", p.id);
    });
    await cache.put(cache.makeKey(msg.tenantId, "payment", p.id), { id: p.id, status: "initiated" });
  });

  sub(COMMANDS.gemInvoiceMatch, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; poRef: string; invoiceRef: string; amountMinor: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Record in outbox — downstream bill creation handles the actual 3-way match
      await enqueue(tx, {
        topic: "finance.gem.invoice.matched", eventType: "finance.gem.invoice.matched",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { poRef: p.poRef, invoiceRef: p.invoiceRef, amountMinor: minorString(p.amountMinor) },
      });
      await audit(tx, msg, "gem_match", "gem_invoice", p.id);
    });
  });

  sub(COMMANDS.advanceCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; advanceNo: string; purpose: string; payee?: string;
      type?: string; amountMinor: number; currency?: string; dueDate?: string;
    };
    const today = new Date().toISOString().slice(0, 10);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertAdvance(tx, {
        id: p.id, tenantId: p.tenantId, advanceNo: p.advanceNo,
        // beneficiary is NOT NULL; fall back to the (required) purpose when no payee given.
        beneficiary: p.payee && p.payee.trim() ? p.payee.trim() : p.purpose,
        type: p.type ?? "employee",
        amountMinor: BigInt(p.amountMinor), currency: p.currency ?? "INR",
        disbursedDate: today,
        ...(p.dueDate ? { dueDate: p.dueDate } : {}),
        purpose: p.purpose,
        status: "active", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "advance", p.id);
    });
    await cache.invalidateResource(msg.tenantId, "advances");
  });

  sub(COMMANDS.ucCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; ucNo: string; purpose: string; scheme?: string;
      grantRef?: string; amountMinor: number; currency?: string; periodFrom?: string; periodTo?: string;
    };
    const today = new Date().toISOString().slice(0, 10);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertUC(tx, {
        id: p.id, tenantId: p.tenantId, ucNo: p.ucNo,
        grantRef: p.grantRef ?? p.scheme ?? null,
        // grantee is NOT NULL; fall back to the (required) purpose when no scheme given.
        grantee: p.scheme && p.scheme.trim() ? p.scheme.trim() : p.purpose,
        amountMinor: BigInt(p.amountMinor), currency: p.currency ?? "INR",
        periodFrom: p.periodFrom ?? today,
        periodTo: p.periodTo ?? today,
        submittedDate: today,
        purpose: p.purpose,
        status: "submitted", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "utilization_certificate", p.id);
    });
    await cache.invalidateResource(msg.tenantId, "uc");
  });

  sub(COMMANDS.advanceAdjust, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; adjustedMinor: number; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const advance = await repo.findAdvanceByIdTx(tx, p.id);
      if (!advance) throw new Error(`advance ${p.id} not found`);
      const newAdjusted = BigInt(advance.adjustedMinor) + BigInt(p.adjustedMinor);
      const balance = BigInt(advance.amountMinor) - newAdjusted;
      const newStatus = balance <= 0n ? "adjusted" : advance.status;
      await repo.updateAdvance(tx, p.id, {
        adjustedMinor: newAdjusted,
        status: newStatus,
        updatedBy: msg.actorId,
      });
      await audit(tx, msg, "adjust", "advance", p.id);
    });
    await cache.invalidateResource(msg.tenantId, "advances");
  });

  sub(COMMANDS.paymentSubmitApproval, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const payment = await repo.findPaymentByIdTx(tx, p.id);
      if (!payment || payment.tenantId !== p.tenantId) return;
      await repo.updatePayment(tx, p.id, { status: "pending_approval", updatedBy: msg.actorId });
      await audit(tx, msg, "submit_for_eoffice_approval", "payment", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "payment", p.id));
  });

  /**
   * procurement.grn.accepted → three-way match validation.
   * Validates PO amounts match GRN amounts (within 5% tolerance), creates a
   * draft bill, and emits procurement.three_way_match.passed or .failed.
   */
  sub(CONSUMED_EVENTS.grnAccepted, async (msg) => {
    const p = msg.payload as {
      poId: string; grnId: string; vendorId: string;
      lineItems?: Array<{ description?: string; quantity?: number; unitPriceMinor?: number }>;
      totalMinor: number | string;
      tenantId: string; messageId?: string;
      poAmountMinor?: number | string;
    };
    // Advisory gate (emits passed/failed); the hard authorisation gate is on
    // billApprove above. Default here is 5% (looser than the approve default)
    // because this fires on receipt, before the invoice is known.
    const THREE_WAY_MATCH_TOLERANCE_PCT = resolveThreeWayTolerancePct(5);
    const grnTotalMinor = BigInt(p.totalMinor ?? 0);
    const poAmountMinor = p.poAmountMinor != null ? BigInt(p.poAmountMinor) : grnTotalMinor;
    const billId = randomUUID();
    const poRef = `procurement_po:${p.poId}`;
    const grnRef = `procurement_grn:${p.grnId}`;
    const headId = process.env.FINANCE_DEFAULT_HEAD_ID ?? "dddddddd-0001-0000-0000-000000000001";

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Insert draft bill
      await repo.insertBill(tx, {
        id: billId,
        tenantId: msg.tenantId,
        billNo: `BILL/GRN/${p.grnId.slice(0, 8).toUpperCase()}`,
        vendorId: p.vendorId,
        headId,
        grossMinor: grnTotalMinor,
        netMinor: grnTotalMinor,
        poRef,
        grnRef,
        stage: "section",
        status: "draft",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      // Three-way match validation: compare PO amount vs GRN amount (tolerance-based).
      // Deviation = |poAmount - grnAmount|.
      const deviationMinor = grnTotalMinor > poAmountMinor
        ? grnTotalMinor - poAmountMinor
        : poAmountMinor - grnTotalMinor;
      // The DECISION uses exact integer arithmetic. `variance` below is REPORTING
      // ONLY: its BigInt division truncates toward zero, so it quantises to
      // 0.01%-of-PO steps and under-reports (on a Rs 1 crore PO the quantum is
      // Rs 1,000). Deciding on it admitted overage the tolerance forbids.
      const matched = !deviationExceedsTolerance(deviationMinor, poAmountMinor, THREE_WAY_MATCH_TOLERANCE_PCT);
      const variance = poAmountMinor > 0n
        ? Number(deviationMinor * 10000n / poAmountMinor) / 100
        : (grnTotalMinor > 0n ? Number.POSITIVE_INFINITY : 0);

      if (matched) {
        // Match passes
        await enqueue(tx, {
          topic: "procurement.three_way_match.passed",
          eventType: "procurement.three_way_match.passed",
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            poId: p.poId,
            grnId: p.grnId,
            billId,
            vendorId: p.vendorId,
            poAmountMinor: poAmountMinor.toString(),
            grnAmountMinor: grnTotalMinor.toString(),
            variancePct: variance,
          },
        });
      } else {
        // Match fails — variance exceeds tolerance
        await enqueue(tx, {
          topic: "procurement.three_way_match.failed",
          eventType: "procurement.three_way_match.failed",
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            poId: p.poId,
            grnId: p.grnId,
            billId,
            vendorId: p.vendorId,
            poAmountMinor: poAmountMinor.toString(),
            grnAmountMinor: grnTotalMinor.toString(),
            variancePct: variance,
            reason: `Amount variance ${variance.toFixed(2)}% exceeds ${THREE_WAY_MATCH_TOLERANCE_PCT}% tolerance (PO: ${poAmountMinor} paise, GRN: ${grnTotalMinor} paise)`,
          },
        });
      }

      await audit(tx, msg, "three_way_match", "bill", billId);
    });

    await cache.invalidateResource(msg.tenantId, "bills");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
