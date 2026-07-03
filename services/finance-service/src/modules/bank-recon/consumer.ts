import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import * as repo from "./repo.js";
import { autoMatch, type StatementLine, type BookEntry } from "./domain.js";

const log = pino({ name: "finance.bank-recon.consumer" });

const AUDIT_TOPIC = "audit.event.record";

export function registerBankReconConsumers(queue: Queue): void {
  queue.subscribe("finance.bank_statement.import", async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; bankAccountId: string; statementRef?: string;
      periodFrom?: string; periodTo?: string; openingMinor?: number; closingMinor?: number;
      lines: Array<{ date: string; amountMinor: number; direction: "debit" | "credit"; narration?: string; reference?: string }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertStatement(tx, {
        id: p.id,
        tenantId: p.tenantId,
        bankAccountId: p.bankAccountId,
        ...(p.statementRef ? { statementRef: p.statementRef } : {}),
        ...(p.periodFrom ? { periodFrom: p.periodFrom } : {}),
        ...(p.periodTo ? { periodTo: p.periodTo } : {}),
        openingMinor: BigInt(p.openingMinor ?? 0),
        closingMinor: BigInt(p.closingMinor ?? 0),
        lineCount: p.lines.length,
        status: "imported",
        createdBy: msg.actorId,
      });
      for (const l of p.lines) {
        await repo.insertLine(tx, {
          id: crypto.randomUUID(),
          tenantId: p.tenantId,
          statementId: p.id,
          lineDate: l.date,
          amountMinor: BigInt(l.amountMinor),
          direction: l.direction,
          ...(l.narration ? { narration: l.narration } : {}),
          ...(l.reference ? { reference: l.reference } : {}),
        });
      }
      await enqueue(tx, {
        topic: "finance.bank_statement.imported", eventType: "finance.bank_statement.imported",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { statementId: p.id, lineCount: p.lines.length },
      });
      await audit(tx, msg, "import", "bank_statement", p.id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:bank_statements:*`);
    log.info({ id: msg.messageId }, "Processed bank_statement.import");
  });

  queue.subscribe("finance.bank_statement.reconcile", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; nearDays?: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const stmt = await repo.findStatement(p.id, p.tenantId);
      if (!stmt) throw new Error(`statement ${p.id} not found`);

      const lines = (await repo.linesForStatement(tx, p.id)).filter((l) => !l.matched);
      const payments = await repo.unreconciledPayments(p.tenantId, stmt.bankAccountId);
      const challans = await repo.unreconciledChallans(p.tenantId, stmt.bankAccountId);

      const debitLines: StatementLine[] = lines.filter((l) => l.direction === "debit")
        .map((l) => ({ id: l.id, amountMinor: l.amountMinor, direction: "debit" as const, date: l.lineDate, reference: l.reference }));
      const creditLines: StatementLine[] = lines.filter((l) => l.direction === "credit")
        .map((l) => ({ id: l.id, amountMinor: l.amountMinor, direction: "credit" as const, date: l.lineDate, reference: l.reference }));

      const paymentBooks: BookEntry[] = payments.map((pp) => ({ id: pp.id, amountMinor: pp.amountMinor, date: pp.date, reference: pp.reference }));
      const challanBooks: BookEntry[] = challans.map((c) => ({ id: c.id, amountMinor: c.amountMinor, date: c.date, reference: c.reference }));

      const nearDays = p.nearDays ?? 3;
      const payPairs = autoMatch(debitLines, paymentBooks, nearDays);
      const recPairs = autoMatch(creditLines, challanBooks, nearDays);

      let matched = 0;
      for (const pair of payPairs) {
        const won = await repo.markPaymentReconciled(tx, pair.bookId, pair.lineId);
        if (!won) continue;
        await repo.markLineMatched(tx, pair.lineId, "payment", pair.bookId);
        matched += 1;
      }
      for (const pair of recPairs) {
        const won = await repo.markChallanReconciled(tx, pair.bookId, pair.lineId);
        if (!won) continue;
        await repo.markLineMatched(tx, pair.lineId, "receipt", pair.bookId);
        matched += 1;
      }

      await enqueue(tx, {
        topic: "finance.bank_statement.reconciled", eventType: "finance.bank_statement.reconciled",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { statementId: p.id, matchedCount: matched },
      });
      await audit(tx, msg, "reconcile", "bank_statement", p.id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:bank_recon:*`);
    log.info({ id: msg.messageId }, "Processed bank_statement.reconcile");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
