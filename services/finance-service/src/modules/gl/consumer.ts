import { randomUUID } from "node:crypto";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertJournalBalances } from "./domain.js";
import { getPeriodStatus } from "../period-close/routes.js";
import type { JournalLine } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

const DEP_EXPENSE = process.env.FINANCE_DEP_EXPENSE_CODE ?? "5100";
const DEP_EXPENSE_STAT = process.env.FINANCE_STAT_DEP_EXPENSE_CODE ?? "5101";
const ACCUM_DEP = process.env.FINANCE_ACCUM_DEP_CODE ?? "1250";
const FIXED_ASSET = process.env.FINANCE_FIXED_ASSET_CODE ?? "1200";
const GAIN_LOSS = process.env.FINANCE_GAIN_LOSS_CODE ?? "4200";
const CASH = process.env.FINANCE_CASH_CODE ?? "1100";

type StandardJournal = {
  id: string; tenantId: string; voucherNo: string; type: string;
  postingDate: string; lines: JournalLine[];
};

async function postJournal(
  tx: Parameters<typeof markProcessed>[0],
  msg: CommandEnvelope,
  journal: StandardJournal,
): Promise<void> {
  assertJournalBalances(journal.lines);
  const period = journal.postingDate.slice(0, 7);
  const periodStatus = await getPeriodStatus(journal.tenantId, period);
  if (periodStatus === "hard_close") {
    throw new Error(`PERIOD_CLOSED: cannot post to hard-closed period ${period}`);
  }
  if (periodStatus === "soft_close" && !(["adjustment", "closing"].includes(journal.type))) {
    throw new Error(`PERIOD_SOFT_CLOSED: only adjustment/closing journals allowed in soft-closed period ${period}`);
  }
  await repo.insertJournal(tx, {
    id: journal.id, tenantId: journal.tenantId, voucherNo: journal.voucherNo,
    type: journal.type, postingDate: journal.postingDate, lines: journal.lines,
    status: "posted", createdBy: msg.actorId, updatedBy: msg.actorId,
  });
  for (const line of journal.lines) {
    await repo.insertLedgerLine(tx, {
      id: randomUUID(), tenantId: journal.tenantId,
      headId: line.accountCode,
      debitMinor: BigInt(line.debitMinor), creditMinor: BigInt(line.creditMinor),
      balanceMinor: BigInt(line.debitMinor) - BigInt(line.creditMinor),
      voucherNo: journal.voucherNo, postingDate: journal.postingDate,
      createdBy: msg.actorId, updatedBy: msg.actorId,
    });
  }
  await enqueue(tx, {
    topic: EVENTS.glPosted, eventType: EVENTS.glPosted,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { journalId: journal.id, voucherNo: journal.voucherNo },
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
      const amount = Number(dep.depAmountMinor);
      const expenseCode = dep.depBook === "statutory" ? DEP_EXPENSE_STAT : DEP_EXPENSE;
      const journalId = randomUUID();
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await postJournal(tx, msg, {
          id: journalId,
          tenantId: msg.tenantId,
          voucherNo: `DEP/${dep.depBook ?? "company"}/${dep.period}/${String(dep.assetId).slice(0, 8)}`,
          type: "depreciation",
          postingDate: `${dep.period}-28`,
          lines: [
            { accountCode: expenseCode, debitMinor: amount, creditMinor: 0 },
            { accountCode: ACCUM_DEP, debitMinor: 0, creditMinor: amount },
          ],
        });
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, "gl_trial_balance", msg.tenantId));
      return;
    }

    if (raw.type === "asset_disposal") {
      const d = raw as {
        assetId: string; acquisitionCost: string; accumulatedDep: string;
        proceeds: number; gainLoss: string; currency?: string;
      };
      const acq = Number(d.acquisitionCost);
      const accum = Number(d.accumulatedDep);
      const proceeds = Number(d.proceeds ?? 0);
      const gainLoss = Number(d.gainLoss);
      const journalId = randomUUID();
      const today = new Date().toISOString().slice(0, 10);
      const lines: JournalLine[] = [
        { accountCode: ACCUM_DEP, debitMinor: accum, creditMinor: 0 },
        { accountCode: FIXED_ASSET, debitMinor: 0, creditMinor: acq },
      ];
      if (proceeds > 0) {
        lines.push({ accountCode: CASH, debitMinor: proceeds, creditMinor: 0 });
      }
      if (gainLoss > 0) {
        lines.push({ accountCode: GAIN_LOSS, debitMinor: 0, creditMinor: gainLoss });
      } else if (gainLoss < 0) {
        lines.push({ accountCode: GAIN_LOSS, debitMinor: Math.abs(gainLoss), creditMinor: 0 });
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
}
