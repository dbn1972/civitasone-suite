import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import * as budgetRepo from "../budget/repo.js";
import { enqueueSpineJournal, deterministicId } from "../gl/spine.js";
import { postCashBook } from "../../shared/cashbook.js";
import { fyFromDate, nextDocNo } from "../hoa/voucher.js";
import type { JournalLine } from "../gl/schema.js";

const BANK_CODE = process.env.FINANCE_BANK_CODE ?? "1100";
// Deposits / retention liability control + forfeiture income (seeded in 0015).
const DEPOSIT_LIABILITY_CODE = process.env.FINANCE_DEPOSIT_LIABILITY_CODE ?? "2060";
const FORFEIT_INCOME_CODE = process.env.FINANCE_FORFEIT_INCOME_CODE ?? "4300";

const AUDIT_TOPIC = "audit.event.record";

/** Resolve a control head code to its UUID; hard-error if absent (mirrors AP). */
async function headIdByCode(tx: unknown, tenantId: string, code: string, label: string): Promise<string> {
  const head = await budgetRepo.findHeadByCodeTx(tx as Parameters<typeof budgetRepo.findHeadByCodeTx>[0], tenantId, code);
  if (!head) throw new Error(`MISSING_CONTROL_HEAD: ${label} head code ${code} not found for tenant`);
  return head.id;
}

export function registerTreasuryConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.challanCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; challanNo: string; receiptHeadId: string;
      depositor: string; amountMinor: number; currency?: string; grnNo?: string;
      bankAccountId?: string;
    };
    const today = new Date().toISOString().slice(0, 10);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // P1-1: gapless, strictly-sequential challan number from the shared atomic
      // allocator (per tenant+FY+series). A rolled-back create consumes nothing.
      const fy = fyFromDate(today);
      const { docNo: challanNo } = await nextDocNo(
        tx as unknown as Parameters<typeof nextDocNo>[0], p.tenantId, fy, "CHLN",
      );
      await repo.insertChallan(tx, {
        id: p.id, tenantId: p.tenantId, challanNo,
        receiptHeadId: p.receiptHeadId, depositor: p.depositor,
        amountMinor: BigInt(p.amountMinor), currency: p.currency ?? "INR",
        ...(p.bankAccountId ? { bankAccountId: p.bankAccountId } : {}),
        grnNo: p.grnNo ?? null, status: "pending",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      // GL spine: challan/receipt deposited -> Dr Bank / Cr receipt head.
      const bankHead = await budgetRepo.findHeadByCodeTx(tx as Parameters<typeof budgetRepo.findHeadByCodeTx>[0], p.tenantId, BANK_CODE);
      if (!bankHead) throw new Error(`MISSING_CONTROL_HEAD: bank head code ${BANK_CODE} not found for tenant`);
      const amount = BigInt(p.amountMinor);
      const lines: JournalLine[] = [
        { accountCode: bankHead.id,      debitMinor: amount, creditMinor: 0n },
        { accountCode: p.receiptHeadId,  debitMinor: 0n,     creditMinor: amount },
      ];
      await enqueueSpineJournal(tx, {
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        sourceKey: `challan:${p.id}`, type: "receipt",
        postingDate: today, lines,
      });
      // P1-2: cash book (IGFRS cash basis) — challan deposit is cash IN to bank.
      await postCashBook(tx as unknown as Parameters<typeof postCashBook>[0], {
        tenantId: p.tenantId, entryDate: today, voucherType: "receipt",
        voucherNo: challanNo, particulars: `Challan deposit from ${p.depositor}`,
        receiptMinor: amount, paymentMinor: 0n, bankOrCash: "bank",
        reference: `challan:${p.id}`, actorId: msg.actorId,
      });
      await audit(tx, msg, "create", "challan", p.id);
    });
  });

  queue.subscribe(COMMANDS.depositCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; pdNo: string; type: string;
      administrator: string; balanceMinor: number; currency?: string;
      sourceBillId?: string;
    };
    const today = new Date().toISOString().slice(0, 10);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // P1-1: gapless deposit/PD number.
      const fy = fyFromDate(today);
      const { docNo: pdNo } = await nextDocNo(
        tx as unknown as Parameters<typeof nextDocNo>[0], p.tenantId, fy, "PD",
      );
      await repo.insertDeposit(tx, {
        id: p.id, tenantId: p.tenantId, pdNo, type: p.type,
        administrator: p.administrator, balanceMinor: BigInt(p.balanceMinor),
        currency: p.currency ?? "INR", status: "active",
        ...(p.sourceBillId ? { sourceBillId: p.sourceBillId } : {}),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      // GL spine: deposit/retention received -> Dr Bank / Cr Deposits liability.
      // (Retention held from a bill is modelled the same: a liability the entity
      // owes back to the vendor; sourceBillId links it to the originating bill.)
      const bankHeadId = await headIdByCode(tx, p.tenantId, BANK_CODE, "bank");
      const liabHeadId = await headIdByCode(tx, p.tenantId, DEPOSIT_LIABILITY_CODE, "deposit_liability");
      const amount = BigInt(p.balanceMinor);
      if (amount > 0n) {
        const lines: JournalLine[] = [
          { accountCode: bankHeadId, debitMinor: amount, creditMinor: 0n },
          { accountCode: liabHeadId, debitMinor: 0n,     creditMinor: amount },
        ];
        await enqueueSpineJournal(tx, {
          tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          sourceKey: `deposit:${p.id}`, type: "deposit", postingDate: today, lines,
        });
      }
      await audit(tx, msg, "create", "deposit", p.id);
    });
  });

  // P1-3: deposit refund. Pay the held deposit back to the depositor.
  // GL: Dr Deposits liability / Cr Bank. Reduces the held balance.
  queue.subscribe(COMMANDS.depositRefund, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; depositId: string; amountMinor: number };
    await depositDisposition(msg, "refund", p, async (tx, dep, amount, today) => {
      const liabHeadId = await headIdByCode(tx, p.tenantId, DEPOSIT_LIABILITY_CODE, "deposit_liability");
      const bankHeadId = await headIdByCode(tx, p.tenantId, BANK_CODE, "bank");
      const lines: JournalLine[] = [
        { accountCode: liabHeadId, debitMinor: amount, creditMinor: 0n },
        { accountCode: bankHeadId, debitMinor: 0n,     creditMinor: amount },
      ];
      // Cash out of bank for the refund.
      await postCashBook(tx as unknown as Parameters<typeof postCashBook>[0], {
        tenantId: p.tenantId, entryDate: today, voucherType: "payment",
        voucherNo: dep.pdNo, particulars: `Deposit refund ${dep.pdNo} to ${dep.administrator}`,
        receiptMinor: 0n, paymentMinor: amount, bankOrCash: "bank",
        reference: `deposit_refund:${p.id}`, actorId: msg.actorId,
      });
      return lines;
    });
  });

  // P1-3: deposit forfeiture. Forfeit the held deposit to income.
  // GL: Dr Deposits liability / Cr Forfeited-Deposits income. No cash movement.
  queue.subscribe(COMMANDS.depositForfeit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; depositId: string; amountMinor: number };
    await depositDisposition(msg, "forfeit", p, async (tx, _dep, amount) => {
      const liabHeadId = await headIdByCode(tx, p.tenantId, DEPOSIT_LIABILITY_CODE, "deposit_liability");
      const incomeHeadId = await headIdByCode(tx, p.tenantId, FORFEIT_INCOME_CODE, "forfeit_income");
      const lines: JournalLine[] = [
        { accountCode: liabHeadId,   debitMinor: amount, creditMinor: 0n },
        { accountCode: incomeHeadId, debitMinor: 0n,     creditMinor: amount },
      ];
      return lines;
    });
  });

  // P1-3: deposit adjust-against-bill. Apply held retention/deposit toward a
  // payable. GL: Dr Deposits liability / Cr Accounts-Payable control. No cash.
  queue.subscribe(COMMANDS.depositAdjust, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; depositId: string; amountMinor: number; billId?: string };
    await depositDisposition(msg, "adjust", p, async (tx, _dep, amount) => {
      const liabHeadId = await headIdByCode(tx, p.tenantId, DEPOSIT_LIABILITY_CODE, "deposit_liability");
      const apHeadId = await headIdByCode(tx, p.tenantId, process.env.FINANCE_AP_CONTROL_CODE ?? "2050", "accounts_payable");
      const lines: JournalLine[] = [
        { accountCode: liabHeadId, debitMinor: amount, creditMinor: 0n },
        { accountCode: apHeadId,   debitMinor: 0n,     creditMinor: amount },
      ];
      return lines;
    }, (p as { billId?: string }).billId);
  });
}

/**
 * Shared driver for deposit refund / forfeit / adjust. Validates the deposit,
 * guards against over-disposition, posts the supplied GL lines via the spine,
 * records an idempotent lifecycle event, and updates the running balance +
 * status (-> closed when fully disposed). The line builder runs inside the tx.
 */
async function depositDisposition(
  msg: { messageId: string; tenantId: string; actorId: string; correlationId: string },
  event: "refund" | "forfeit" | "adjust",
  p: { id: string; tenantId: string; depositId: string; amountMinor: number },
  buildLines: (
    tx: Parameters<typeof markProcessed>[0], dep: NonNullable<Awaited<ReturnType<typeof repo.findDepositByIdTx>>>, amount: bigint, today: string,
  ) => Promise<JournalLine[]>,
  reference?: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const amount = BigInt(p.amountMinor);
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const dep = await repo.findDepositByIdTx(tx, p.depositId);
    if (!dep || dep.tenantId !== p.tenantId) throw new Error(`UNKNOWN_DEPOSIT: ${p.depositId} not found for tenant`);
    if (amount <= 0n) throw new Error(`INVALID_AMOUNT: deposit ${event} amount must be positive`);
    if (amount > dep.balanceMinor) {
      throw new Error(`DEPOSIT_OVERDRAW: ${event} ${amount} exceeds held balance ${dep.balanceMinor} for ${p.depositId}`);
    }
    const lines = await buildLines(tx, dep, amount, today);
    await enqueueSpineJournal(tx, {
      tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
      sourceKey: `deposit_${event}:${p.id}`, type: `deposit_${event}`, postingDate: today, lines,
    });
    const journalId = deterministicId(`deposit_${event}:${p.id}`);
    await repo.insertDepositEvent(tx, {
      tenantId: p.tenantId, depositId: p.depositId, eventType: event,
      amountMinor: amount, journalId,
      reference: reference ?? `deposit_${event}:${p.id}`, createdBy: msg.actorId,
    });
    const newBalance = dep.balanceMinor - amount;
    await repo.applyDepositDisposition(tx, p.depositId, event, amount, newBalance, msg.actorId);
    await audit(tx, msg, event, "deposit", p.depositId);
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
