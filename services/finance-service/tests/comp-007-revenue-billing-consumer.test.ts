/**
 * COMP-007 -- finance-service `revenue-billing` consumer, real-DB integration test.
 *
 * `registerRevenueBillingConsumers` (src/modules/revenue-billing/consumer.ts) IS
 * wired up for real -- `services/finance-service/src/worker.ts` imports and calls
 * it -- but before this file had zero test references anywhere in the service.
 * It is real, currently-unverified business logic: closes gap "B7" per its own
 * header comment (revenue receipts and SaaS billing events previously had no
 * finance-service subscriber at all, so they never posted to the General Ledger).
 *
 * Runs against the live civitas_finance DB (DATABASE_URL from vitest.config.ts),
 * following the same DB-backed consumer-test shape already used in this service
 * by tests/resolution-intake-consumer.test.ts: a tiny in-process TestQueue feeds
 * the real handler, then the real `_outbox.messages` / `_inbox.processed` tables
 * are queried back to prove what actually got written.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerRevenueBillingConsumers } from "../src/modules/revenue-billing/consumer.js";

type Handler = (msg: any) => Promise<void>;
class TestQueue {
  private handlers = new Map<string, Handler[]>();
  subscribe(topic: string, handler: Handler): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler);
    this.handlers.set(topic, list);
  }
  async deliver(topic: string, msg: any): Promise<void> {
    for (const h of this.handlers.get(topic) ?? []) await h(msg);
  }
}

const TENANT = randomUUID();
const ACTOR = randomUUID();

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: randomUUID(),
    payload,
  };
}

async function outboxRowsForCorrelation(correlationId: string): Promise<any[]> {
  return runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      const r: any = await tx.execute(
        sql`SELECT topic, payload FROM _outbox.messages WHERE correlation_id = ${correlationId} ORDER BY created_at`,
      );
      return Array.isArray(r) ? r : r.rows ?? [];
    }),
  ) as Promise<any[]>;
}

describe("COMP-007: revenue-billing consumer -- revenue.receipt.captured", () => {
  it("posts a balanced collections journal (Dr Cash, Cr Revenue Income) and an audit event", async () => {
    const queue = new TestQueue();
    registerRevenueBillingConsumers(queue as any);

    const receiptId = randomUUID();
    const msg = makeMsg({ receiptId, amountMinor: "150000", currency: "INR", receiptDate: "2026-09-01" });
    await queue.deliver("revenue.receipt.captured", msg);

    const rows = await outboxRowsForCorrelation(msg.correlationId);
    const journalMsg = rows.find((r) => r.topic === "finance.gl.post");
    const auditMsg = rows.find((r) => r.topic === "audit.event.record");

    expect(journalMsg, "expected a finance.gl.post command to be queued").toBeTruthy();
    const lines = journalMsg.payload.lines as Array<{ accountCode: string; debitMinor: string; creditMinor: string }>;
    expect(lines).toHaveLength(2);
    const totalDebit = lines.reduce((a, l) => a + BigInt(l.debitMinor), 0n);
    const totalCredit = lines.reduce((a, l) => a + BigInt(l.creditMinor), 0n);
    expect(totalDebit).toBe(150000n);
    expect(totalDebit).toBe(totalCredit); // journal must balance
    expect(lines[0].accountCode).toBe("1100"); // cash (debit)
    expect(lines[1].accountCode).toBe("4001"); // default revenue income head (credit)

    expect(auditMsg, "expected an audit.event.record to be queued").toBeTruthy();
    expect(auditMsg.payload.action).toBe("revenue_receipt_posted");
  });

  it("is idempotent: redelivering the same messageId does not post a second journal", async () => {
    const queue = new TestQueue();
    registerRevenueBillingConsumers(queue as any);

    const receiptId = randomUUID();
    const msg = makeMsg({ receiptId, amountMinor: "75000", currency: "INR" });

    await queue.deliver("revenue.receipt.captured", msg);
    await queue.deliver("revenue.receipt.captured", msg); // exact same messageId, replayed

    const rows = await outboxRowsForCorrelation(msg.correlationId);
    const journalRows = rows.filter((r) => r.topic === "finance.gl.post");
    expect(journalRows).toHaveLength(1);
  });
});

describe("COMP-007: revenue-billing consumer -- billing.invoice.paid", () => {
  it("posts a balanced cash-receipt journal (Dr Cash, Cr Receivable) for a paid SaaS invoice", async () => {
    const queue = new TestQueue();
    registerRevenueBillingConsumers(queue as any);

    const invoiceId = randomUUID();
    const msg = makeMsg({ invoiceId, paidMinor: "499900", currency: "INR", paidDate: "2026-09-01" });
    await queue.deliver("billing.invoice.paid", msg);

    const rows = await outboxRowsForCorrelation(msg.correlationId);
    const journalMsg = rows.find((r) => r.topic === "finance.gl.post");
    expect(journalMsg).toBeTruthy();
    const lines = journalMsg.payload.lines as Array<{ accountCode: string; debitMinor: string; creditMinor: string }>;
    const totalDebit = lines.reduce((a: bigint, l: any) => a + BigInt(l.debitMinor), 0n);
    const totalCredit = lines.reduce((a: bigint, l: any) => a + BigInt(l.creditMinor), 0n);
    expect(totalDebit).toBe(499900n);
    expect(totalDebit).toBe(totalCredit);
    expect(lines[0].accountCode).toBe("1100"); // cash (debit)
    expect(lines[1].accountCode).toBe("1300"); // receivable (credit)
  });
});
