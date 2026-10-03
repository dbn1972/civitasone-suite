import { NonRetryableError, type Queue } from "@civitasone/queue";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { auditEvent } from "../approvals/apply.js";
import { financeDebt, financeDebtEmi, financeGuarantees } from "./schema.js";
import { assertPaidInOrder, assertPaidOnValid, assertPeriodPostable, buildEmiSchedule, DebtDomainError, istDate } from "./debt-domain.js";
import { requireDebtHeadsTx } from "../approvals/repo.js";
import { getPeriodStatusTx } from "../period-close/repo.js";
import { DomainError } from "../approvals/domain.js";
import { enqueueSpineJournal } from "../gl/spine.js";

export function registerTreasuryRegisterConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.guaranteeCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; entity: string; type: string; amountMinor: string; feePct: string;
      validUntil: string; beneficiary: string; linkedRef?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(financeGuarantees).values({
        id: p.id, tenantId: p.tenantId, entity: p.entity, type: p.type, amountMinor: BigInt(p.amountMinor),
        feePct: p.feePct, validUntil: p.validUntil, beneficiary: p.beneficiary, linkedRef: p.linkedRef ?? null,
        status: "active", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await auditEvent(tx, msg as never, "create_guarantee", "guarantee", p.id, {
        entity: p.entity, type: p.type, amountMinor: p.amountMinor, validUntil: p.validUntil,
      });
    });
    await cache.invalidateResource(msg.tenantId, "guarantees");
  });

  queue.subscribe(COMMANDS.debtCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; instrument: string; source: string; lender: string; principalMinor: string;
      interestRateBps: number; tenureMonths: number; firstEmiDate: string; currency?: string;
    };
    const principal = BigInt(p.principalMinor);
    const schedule = buildEmiSchedule({
      principalMinor: principal, interestRateBps: p.interestRateBps, tenureMonths: p.tenureMonths, firstEmiDate: p.firstEmiDate,
    });
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const today = istDate();
      // The GL refuses a closed period and unusable heads; refuse here (not retryable) so the loan is never created
      // with a receipt journal that cannot post.
      let heads;
      try {
        heads = await requireDebtHeadsTx(tx, p.tenantId);
        assertPeriodPostable(await getPeriodStatusTx(tx, p.tenantId, today.slice(0, 7)), today);
      } catch (err) {
        if (err instanceof DomainError || err instanceof DebtDomainError) throw new NonRetryableError(`[finance/treasury] ${err.message}`);
        throw err;
      }
      // Loan receipt hits the books: Dr bank / Cr loan liability, one journal per loan (deterministic id).
      const receiptJournalId = await enqueueSpineJournal(tx, {
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, sourceKey: `debt:receipt:${p.id}`,
        type: "receipt", postingDate: today,
        lines: [
          { accountCode: heads.bank, debitMinor: principal, creditMinor: 0n, narration: `Loan received: ${p.instrument}` },
          { accountCode: heads.loanLiability, debitMinor: 0n, creditMinor: principal, narration: `Loan received: ${p.instrument}` },
        ] as never,
      });
      await tx.insert(financeDebt).values({
        id: p.id, tenantId: p.tenantId, instrument: p.instrument, source: p.source, lender: p.lender,
        amountMinor: principal, currency: p.currency ?? "INR",
        interestRateBps: p.interestRateBps, tenureMonths: p.tenureMonths, firstEmiDate: p.firstEmiDate,
        maturity: schedule[schedule.length - 1]!.dueDate, outstandingMinor: principal, receiptJournalId,
        status: "active", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await tx.insert(financeDebtEmi).values(schedule.map((r) => ({
        tenantId: p.tenantId, debtId: p.id, installmentNo: r.installmentNo, dueDate: r.dueDate,
        principalMinor: r.principalMinor, interestMinor: r.interestMinor, totalMinor: r.totalMinor, status: "due",
      })));
      await auditEvent(tx, msg as never, "create_debt", "debt", p.id, {
        lender: p.lender, principalMinor: p.principalMinor, interestRateBps: p.interestRateBps, tenureMonths: p.tenureMonths,
      });
    });
    await cache.invalidateResource(msg.tenantId, "debt");
  });

  queue.subscribe(COMMANDS.debtEmiPay, async (msg) => {
    const p = msg.payload as { debtId: string; installmentNo: number; tenantId: string; paidOn: string | null; paymentRef: string | null; bankHeadId?: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Lock the loan row so concurrent payments adjust the outstanding balance one at a time.
      const [debt] = await tx.select().from(financeDebt)
        .where(and(eq(financeDebt.tenantId, p.tenantId), eq(financeDebt.id, p.debtId))).for("update").limit(1);
      if (!debt) throw new NonRetryableError(`[finance/treasury] debt ${p.debtId} not found`);
      const emis = await tx.select({ id: financeDebtEmi.id, no: financeDebtEmi.installmentNo, status: financeDebtEmi.status })
        .from(financeDebtEmi).where(and(eq(financeDebtEmi.tenantId, p.tenantId), eq(financeDebtEmi.debtId, p.debtId)))
        .orderBy(financeDebtEmi.installmentNo);
      const target = emis.find((e) => e.no === p.installmentNo);
      if (!target) throw new NonRetryableError(`[finance/treasury] instalment ${p.installmentNo} of ${p.debtId} not found`);
      // A double click (or a retry after the first command landed) is a recorded no-op, not a dead-lettered error.
      if (target.status === "paid") {
        await auditEvent(tx, msg as never, "pay_debt_emi_noop", "debt", p.debtId, { installmentNo: p.installmentNo, reason: "already paid" });
        return;
      }
      const paidOn = p.paidOn ?? istDate();
      try {
        assertPaidInOrder(p.installmentNo, emis.find((e) => e.status === "due")?.no ?? null);
        assertPaidOnValid(paidOn, debt.firstEmiDate);
        // Never mark an instalment paid if its journal cannot post (closed period): the tx rolls back, the instalment stays due.
        assertPeriodPostable(await getPeriodStatusTx(tx, p.tenantId, paidOn.slice(0, 7)), paidOn);
      } catch (err) {
        if (err instanceof DebtDomainError) throw new NonRetryableError(`[finance/treasury] ${err.message}`);
        throw err;
      }
      let heads;
      try {
        heads = await requireDebtHeadsTx(tx, p.tenantId, { bankHeadId: p.bankHeadId ?? null });
      } catch (err) {
        if (err instanceof DomainError) throw new NonRetryableError(`[finance/treasury] ${err.message}`);
        throw err;
      }
      // Conditional: only a still-due instalment can be marked paid.
      const paid = await tx.update(financeDebtEmi).set({
        status: "paid", paidOn, paidBy: msg.actorId, paymentRef: p.paymentRef, version: sql`${financeDebtEmi.version} + 1`,
      }).where(and(
        eq(financeDebtEmi.id, target.id), eq(financeDebtEmi.tenantId, p.tenantId), eq(financeDebtEmi.status, "due"),
      )).returning({ principalMinor: financeDebtEmi.principalMinor, interestMinor: financeDebtEmi.interestMinor, totalMinor: financeDebtEmi.totalMinor });
      if (paid.length === 0) {
        await auditEvent(tx, msg as never, "pay_debt_emi_noop", "debt", p.debtId, { installmentNo: p.installmentNo, reason: "lost a race" });
        return;
      }
      const e = paid[0]!;
      // Books: Dr loan liability (principal), Dr interest expense / Cr bank (total). One journal per instalment, deterministic id.
      const lines = [
        { accountCode: heads.loanLiability, debitMinor: e.principalMinor, creditMinor: 0n, narration: `Loan instalment ${p.installmentNo}: principal` },
        ...(e.interestMinor > 0n ? [{ accountCode: heads.interestExpense, debitMinor: e.interestMinor, creditMinor: 0n, narration: `Loan instalment ${p.installmentNo}: interest` }] : []),
        { accountCode: heads.bank, debitMinor: 0n, creditMinor: e.totalMinor, narration: `Loan instalment ${p.installmentNo}` },
      ];
      const journalId = await enqueueSpineJournal(tx, {
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, sourceKey: `debt:emi:${target.id}`,
        type: "payment", postingDate: paidOn, lines: lines as never,
      });
      await tx.update(financeDebtEmi).set({ journalId }).where(eq(financeDebtEmi.id, target.id));
      const remaining = (debt.outstandingMinor ?? debt.amountMinor) - e.principalMinor;
      const left = emis.filter((x) => x.status === "due" && x.id !== target.id).length;
      await tx.update(financeDebt).set({
        outstandingMinor: remaining, status: left === 0 ? "closed" : debt.status,
        updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${financeDebt.version} + 1`,
      }).where(eq(financeDebt.id, p.debtId));
      await auditEvent(tx, msg as never, "pay_debt_emi", "debt", p.debtId, {
        installmentNo: p.installmentNo, principalMinor: e.principalMinor.toString(), paymentRef: p.paymentRef, closed: left === 0, journalId,
      });
    });
    await cache.invalidateResource(msg.tenantId, "debt");
  });
}
