import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertJournalBalances } from "./domain.js";
import type { JournalLine } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerGlConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.journalPost, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; voucherNo: string; type: string;
      postingDate: string; lines: JournalLine[];
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      assertJournalBalances(p.lines);
      await repo.insertJournal(tx, {
        id: p.id, tenantId: p.tenantId, voucherNo: p.voucherNo,
        type: p.type, postingDate: p.postingDate, lines: p.lines,
        status: "posted", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      // Expand each line into the ledger
      for (const line of p.lines) {
        await repo.insertLedgerLine(tx, {
          id: randomUUID(), tenantId: p.tenantId,
          headId: line.accountCode, // accountCode is the head id in LMMHA format; stored as text FK-free
          debitMinor: BigInt(line.debitMinor), creditMinor: BigInt(line.creditMinor),
          balanceMinor: BigInt(line.debitMinor) - BigInt(line.creditMinor),
          voucherNo: p.voucherNo, postingDate: p.postingDate,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
      }
      await enqueue(tx, {
        topic: EVENTS.glPosted, eventType: EVENTS.glPosted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { journalId: p.id, voucherNo: p.voucherNo },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "finance", action: "post_journal", resourceType: "journal", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "gl_trial_balance", msg.tenantId));
  });
}
