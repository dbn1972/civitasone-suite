import { randomUUID } from "node:crypto";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as budgetRepo from "../budget/repo.js";
import { assertJournalBalances } from "./domain.js";
import { getPeriodStatus } from "../period-close/routes.js";
import { nextVoucherNo, fyFromDate } from "../hoa/voucher.js";
import { deterministicId } from "./spine.js";
import type { JournalLine } from "./schema.js";
import { validateOrgAssignment } from "../org-structure/domain.js";

const AUDIT_TOPIC = "audit.event.record";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a line's accountCode to a head UUID for the uuid head_id ledger column.
 * GL-spine callers (bills/payments/challans) already pass UUIDs and pass through
 * unchanged. The depreciation / asset-disposal / manual-journal paths build
 * lines from raw 4-digit account CODES — previously these were inserted straight
 * into the uuid head_id column and the row dead-lettered. We now resolve the
 * code to its head UUID via the per-tenant master; an unknown code is cleanly
 * rejected with a clear error instead of poisoning the queue.
 */
async function resolveHeadIdTx(tx: unknown, tenantId: string, accountCode: string): Promise<string> {
  if (UUID_RE.test(accountCode)) return accountCode;
  const head = await budgetRepo.findHeadByCodeTx(
    tx as Parameters<typeof budgetRepo.findHeadByCodeTx>[0], tenantId, accountCode,
  );
  if (!head) throw new Error(`UNKNOWN_ACCOUNT_CODE: head code ${accountCode} not found for tenant ${tenantId}`);
  return head.id;
}

const DEP_EXPENSE = process.env.FINANCE_DEP_EXPENSE_CODE ?? "5100";
const DEP_EXPENSE_STAT = process.env.FINANCE_STAT_DEP_EXPENSE_CODE ?? "5101";
const ACCUM_DEP = process.env.FINANCE_ACCUM_DEP_CODE ?? "1250";
const FIXED_ASSET = process.env.FINANCE_FIXED_ASSET_CODE ?? "1200";
const GAIN_LOSS = process.env.FINANCE_GAIN_LOSS_CODE ?? "4200";
const CASH = process.env.FINANCE_CASH_CODE ?? "1100";

type StandardJournal = {
  id: string; tenantId: string; voucherNo: string; type: string;
  postingDate: string; lines: JournalLine[]; reversesId?: string;
  legalEntityId?: string; costCenterId?: string; profitCenterId?: string; operatingUnitId?: string;
};

async function postJournal(
  tx: Parameters<typeof markProcessed>[0],
  msg: CommandEnvelope,
  journal: StandardJournal,
): Promise<void> {
  assertJournalBalances(journal.lines);
  // ERP org-structure validation: if a legal entity is assigned, verify all org refs belong to it.
  await validateOrgAssignment(journal.tenantId, {
    legalEntityId: journal.legalEntityId ?? null,
    costCenterId: journal.costCenterId ?? null,
    profitCenterId: journal.profitCenterId ?? null,
    operatingUnitId: journal.operatingUnitId ?? null,
  });
  // M2: lines must be non-negative and the journal must move money. A balanced
  // 0==0 journal (or negative legs) posts an empty / nonsensical voucher — reject.
  let totalDebit = 0n;
  for (const l of journal.lines) {
    const dr = BigInt(l.debitMinor);
    const cr = BigInt(l.creditMinor);
    if (dr < 0n || cr < 0n) {
      throw new Error("JOURNAL_NEGATIVE_LINE: debit/credit amounts must be non-negative");
    }
    totalDebit += dr;
  }
  if (totalDebit === 0n) {
    // INT-FIX: an empty (0==0) journal has nothing to post. This occurs when an
    // upstream producer emits an accrual for a source with zero net movement
    // (e.g. a payroll run approved with no slips, or an empty stock entry).
    // Treat it as a harmless no-op: ack and skip posting instead of throwing,
    // which previously dead-lettered the message and let it retry forever.
    // Unbalanced journals (dr != cr) are still rejected above by
    // assertJournalBalances; negative legs are still rejected above. A genuinely
    // empty journal is noise, not corruption.
    return;
  }
  const period = journal.postingDate.slice(0, 7);
  const periodStatus = await getPeriodStatus(journal.tenantId, period);
  if (periodStatus === "hard_close") {
    throw new Error(`PERIOD_CLOSED: cannot post to hard-closed period ${period}`);
  }
  if (periodStatus === "soft_close" && !(["adjustment", "closing"].includes(journal.type))) {
    throw new Error(`PERIOD_SOFT_CLOSED: only adjustment/closing journals allowed in soft-closed period ${period}`);
  }
  // Gapless voucher numbering: if the caller did not supply a voucher number
  // (or asked for AUTO), allocate a strictly-sequential one under a row lock.
  let voucherNo = journal.voucherNo;
  if (!voucherNo || voucherNo.trim() === "" || voucherNo.toUpperCase() === "AUTO") {
    const fy = fyFromDate(journal.postingDate);
    const series = (journal.type || "JV").slice(0, 8).toUpperCase();
    const allocated = await nextVoucherNo(
      tx as unknown as Parameters<typeof nextVoucherNo>[0],
      journal.tenantId, fy, series,
    );
    voucherNo = allocated.voucherNo;
  }
  // Idempotency: a journal id is deterministic for GL-spine postings (keyed off
  // the source doc). If it already exists, this is a redelivery — skip silently
  // so bills/payments/receipts never double-post.
  if (await repo.findJournalByIdTx(tx, journal.id)) return;
  await repo.insertJournal(tx, {
    id: journal.id, tenantId: journal.tenantId, voucherNo,
    type: journal.type, postingDate: journal.postingDate, lines: journal.lines,
    status: "posted", createdBy: msg.actorId, updatedBy: msg.actorId,
    ...(journal.reversesId ? { reversesId: journal.reversesId } : {}),
      ...(journal.legalEntityId ? { legalEntityId: journal.legalEntityId } : {}),
      ...(journal.costCenterId ? { costCenterId: journal.costCenterId } : {}),
      ...(journal.profitCenterId ? { profitCenterId: journal.profitCenterId } : {}),
      ...(journal.operatingUnitId ? { operatingUnitId: journal.operatingUnitId } : {}),
  });
  for (const line of journal.lines) {
    // P5: resolve raw account codes -> head UUIDs so the depreciation / disposal
    // / manual-journal paths post instead of dead-lettering on the uuid column.
    const headId = await resolveHeadIdTx(tx, journal.tenantId, line.accountCode);
    await repo.insertLedgerLine(tx, {
      id: randomUUID(), tenantId: journal.tenantId,
      headId,
      debitMinor: BigInt(line.debitMinor), creditMinor: BigInt(line.creditMinor),
      balanceMinor: BigInt(line.debitMinor) - BigInt(line.creditMinor),
      voucherNo, postingDate: journal.postingDate,
      createdBy: msg.actorId, updatedBy: msg.actorId,
    });
  }
  await enqueue(tx, {
    topic: EVENTS.glPosted, eventType: EVENTS.glPosted,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { journalId: journal.id, voucherNo },
  });
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action: "post_journal", resourceType: "journal", resourceId: journal.id, outcome: "success" },
  });
}

export function registerGlConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.journalPost, async (msg) => {
    const raw = msg.payload as Record<string, unknown>;

    if (raw.type === "depreciation") {
      const dep = raw as {
        assetId: string; period: string; depAmountMinor: string; currency?: string; depBook?: string;
      };
      // M1: carry paise as a decimal string -> BigInt (no Number() on aggregate paise).
      const amount = BigInt(dep.depAmountMinor);
      const expenseCode = dep.depBook === "statutory" ? DEP_EXPENSE_STAT : DEP_EXPENSE;
      // C1: deterministic journal id keyed off the depreciation source so an
      // outbox redelivery hits the journal PK and no-ops (mirrors the GL spine).
      const depKey = `depreciation:${dep.assetId}:${dep.period}:${dep.depBook ?? "company"}`;
      const journalId = deterministicId(depKey);
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await postJournal(tx, msg, {
          id: journalId,
          tenantId: msg.tenantId,
          voucherNo: `DEP/${dep.depBook ?? "company"}/${dep.period}/${String(dep.assetId).slice(0, 8)}`,
          type: "depreciation",
          postingDate: `${dep.period}-28`,
          lines: [
            { accountCode: expenseCode, debitMinor: amount.toString(), creditMinor: "0" },
            { accountCode: ACCUM_DEP, debitMinor: "0", creditMinor: amount.toString() },
          ],
        });
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, "gl_trial_balance", msg.tenantId));
      return;
    }

    if (raw.type === "asset_disposal") {
      const d = raw as {
        assetId: string; acquisitionCost: string; accumulatedDep: string;
        proceeds: string | number; gainLoss: string; currency?: string;
      };
      // M1: carry paise as decimal strings -> BigInt (no Number() on paise).
      const acq = BigInt(d.acquisitionCost);
      const accum = BigInt(d.accumulatedDep);
      const proceeds = BigInt(d.proceeds ?? 0);
      const gainLoss = BigInt(d.gainLoss);
      // C1: deterministic journal id keyed off the asset disposal so redelivery
      // hits the journal PK and no-ops (mirrors the GL spine).
      const journalId = deterministicId(`asset_disposal:${d.assetId}`);
      const today = new Date().toISOString().slice(0, 10);
      const lines: JournalLine[] = [
        { accountCode: ACCUM_DEP, debitMinor: accum.toString(), creditMinor: "0" },
        { accountCode: FIXED_ASSET, debitMinor: "0", creditMinor: acq.toString() },
      ];
      if (proceeds > 0n) {
        lines.push({ accountCode: CASH, debitMinor: proceeds.toString(), creditMinor: "0" });
      }
      if (gainLoss > 0n) {
        lines.push({ accountCode: GAIN_LOSS, debitMinor: "0", creditMinor: gainLoss.toString() });
      } else if (gainLoss < 0n) {
        lines.push({ accountCode: GAIN_LOSS, debitMinor: (-gainLoss).toString(), creditMinor: "0" });
      }
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await postJournal(tx, msg, {
          id: journalId,
          tenantId: msg.tenantId,
          voucherNo: `DISP/${today}/${String(d.assetId).slice(0, 8)}`,
          type: "asset_disposal",
          postingDate: today,
          lines,
        });
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, "gl_trial_balance", msg.tenantId));
      return;
    }

    const p = raw as StandardJournal;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await postJournal(tx, msg, p);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "gl_trial_balance", msg.tenantId));
  });

  // P0-3: reversal = contra-as-creation. Post a NEW mirror journal (debits and
  // credits swapped) linked to the original via reverses_id, then mark the
  // original 'reversed' through the controlled status transition the DB trigger
  // permits (posted -> reversed). The original's lines/amounts are never mutated.
  queue.subscribe(COMMANDS.journalReverse, async (msg) => {
    const raw = msg.payload as { id: string; tenantId: string; originalJournalId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const original = await repo.findJournalByIdTx(tx, raw.originalJournalId);
      if (!original) throw new Error(`JOURNAL_NOT_FOUND: ${raw.originalJournalId}`);
      if (original.tenantId !== msg.tenantId) throw new Error(`JOURNAL_TENANT_MISMATCH: ${raw.originalJournalId}`);
      if (original.status === "reversed") return; // already reversed — idempotent no-op
      if (original.status !== "posted") throw new Error(`JOURNAL_NOT_POSTED: cannot reverse status '${original.status}'`);
      const origLines = (original.lines ?? []) as JournalLine[];
      const mirrorLines: JournalLine[] = origLines.map((l) => ({
        accountCode: l.accountCode,
        // Serialise paise as decimal strings (jsonb cannot hold BigInt); the
        // posting path rebuilds them with BigInt(...). Swap Dr<->Cr.
        debitMinor: BigInt(l.creditMinor).toString(),
        creditMinor: BigInt(l.debitMinor).toString(),
        ...(l.narration ? { narration: `REVERSAL: ${l.narration}` } : {}),
      }));
      // Deterministic mirror id keyed off the original, so redelivery cannot
      // create two mirror journals.
      const mirrorId = raw.id;
      const today = new Date().toISOString().slice(0, 10);
      await postJournal(tx, msg, {
        id: mirrorId,
        tenantId: msg.tenantId,
        voucherNo: "AUTO",
        type: "contra",
        postingDate: today,
        lines: mirrorLines,
        reversesId: original.id,
      });
      await repo.markJournalReversed(tx, original.id, msg.actorId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "gl_trial_balance", msg.tenantId));
  });
}
