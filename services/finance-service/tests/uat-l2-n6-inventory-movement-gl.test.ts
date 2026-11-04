/**
 * UAT L2-N6 (+ review): inventory-service stock movements on finance.gl.post, per the tenant accounting basis.
 * Real Postgres (finance app role, FORCE RLS), real GL consumer on a MemoryQueue.
 *  - cash (default, no settings row): NO journal, the movement is recorded in gl.stores_valuation_memo, idempotent;
 *    the inbox-marked dead letters (e6932aac case) are acknowledged on re-drive.
 *  - accrual: GRN receipt Dr 1400 / Cr GRNI 2080; the GRN bill clears GRNI to 0 (Dr GRNI / Cr bill head);
 *    manual receipt Dr 1400 / Cr stores suspense 2085 (never the GRN bill head); issue Dr the consuming head or 5300
 *    (+ warning) / Cr 1400; voucher from the AUTO gapless series; a legacy receipt is held (DLQ), not guessed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq, and, sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeJournals, financeJournalLines } from "../src/modules/gl/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeSettings } from "../src/modules/approvals/schema.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financePeriodClose } from "../src/modules/period-close/schema.js";
import { storesValuationMemo } from "../src/modules/gl/stores-memo.js";
import { clearGrniTx } from "../src/modules/gl/grni-clearing.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { deterministicId } from "../src/modules/gl/spine.js";
import { COMMANDS } from "../src/topics.js";

const CASH = randomUUID();
const ACC = randomUUID();
const ACTOR = randomUUID();
const msgIds: string[] = [];
const heads: Record<string, string> = {};

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  return q;
}
let q: MemoryQueue;

async function publish(tenantId: string, payload: Record<string, unknown>, messageId = randomUUID()): Promise<void> {
  msgIds.push(messageId);
  await q.publish(COMMANDS.journalPost, { messageId, type: COMMANDS.journalPost, tenantId, actorId: ACTOR, correlationId: `n6-${messageId.slice(0, 8)}`, schemaVersion: "1.0", payload });
  await q.drain();
}
/** The outbox relay, for the journals the consumer enqueued (GRNI clearing): re-publish them to the GL consumer. */
async function relayJournal(tenantId: string, journalId: string): Promise<void> {
  const rows = await scoped(tenantId, (tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, tenantId), eq(outboxMessages.topic, COMMANDS.journalPost), sql`${outboxMessages.payload}->>${"id"} = ${journalId}`)));
  expect(rows.length).toBeGreaterThan(0);
  await publish(tenantId, rows[0]!.payload as Record<string, unknown>);
}
const movementJournal = (tenantId: string, movementId: string) =>
  scoped(tenantId, (tx) => tx.select().from(financeJournals).where(and(eq(financeJournals.tenantId, tenantId), eq(financeJournals.id, deterministicId(`inventory_movement:${movementId}`)))));
const journalsOfType = (tenantId: string) => scoped(tenantId, (tx) => tx.select().from(financeJournals).where(and(eq(financeJournals.tenantId, tenantId), eq(financeJournals.type, "inventory_movement"))));
async function linesOf(tenantId: string, journalId: string): Promise<string[][]> {
  const rows = await scoped(tenantId, (tx) => tx.select().from(financeJournalLines).where(eq(financeJournalLines.journalId, journalId)));
  return (rows as Array<{ headCode: string | null; debitMinor: bigint; creditMinor: bigint }>).map((r) => [r.headCode ?? "", String(r.debitMinor), String(r.creditMinor)]).sort();
}
async function balanceOf(tenantId: string, code: string): Promise<bigint> {
  const rows = await scoped(tenantId, (tx) => tx.select().from(financeJournalLines).where(and(eq(financeJournalLines.tenantId, tenantId), eq(financeJournalLines.headCode, code))));
  return (rows as Array<{ debitMinor: bigint; creditMinor: bigint }>).reduce((s, r) => s + BigInt(r.debitMinor) - BigInt(r.creditMinor), 0n);
}
const memoOf = (tenantId: string, movementId: string) => scoped(tenantId, (tx) => tx.select().from(storesValuationMemo).where(and(eq(storesValuationMemo.tenantId, tenantId), eq(storesValuationMemo.movementId, movementId))));
const receipt = (movementId: string, extra: Record<string, unknown> = {}) => ({ type: "inventory_movement", movementId, kind: "receipt", totalMinor: "300100", postingDate: "2026-11-04", ...extra });

beforeAll(async () => {
  const chart: Array<[string, string, string]> = [["1400", "Stores / Inventory", "asset"], ["2080", "GRNI", "liability"], ["2085", "Stores Receipts Suspense", "liability"], ["5300", "Stores Consumed", "expense"], ["2202", "General Education", "expense"], ["2210", "Medical", "expense"]];
  for (const [code, name, classification] of chart) {
    const id = randomUUID(); heads[code] = id;
    await scoped(ACC, (tx) => tx.insert(financeHeads).values({ id, tenantId: ACC, code, name, level: 1, classification, createdBy: ACTOR, updatedBy: ACTOR }));
  }
  await scoped(ACC, (tx) => tx.insert(financeSettings).values({ tenantId: ACC, accountingBasis: "accrual", updatedBy: ACTOR }));
  q = tenantWrappedQueue();
  registerGlConsumers(q);
  await q.start();
});
afterAll(async () => {
  await q.stop();
  for (const t of [CASH, ACC]) await scoped(t, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t))).catch(() => {});
  for (const m of msgIds) await db.delete(processed).where(eq(processed.messageId, m)).catch(() => {});
  await sqlClient.end();
});

describe("cash basis (the default): stores memorandum, no GL journal", () => {
  it("records a GRN receipt and an issue in the memo and posts no journal", async () => {
    const r = randomUUID(); const i = randomUUID(); const grn = randomUUID();
    await publish(CASH, receipt(r, { refDoc: "GRN", refNo: grn }));
    await publish(CASH, { type: "inventory_movement", movementId: i, kind: "issue", totalMinor: "5000", postingDate: "2026-11-04" });
    expect(q.dlq.length).toBe(0);
    expect(await journalsOfType(CASH)).toHaveLength(0);
    expect(await memoOf(CASH, r)).toMatchObject([{ kind: "receipt", totalMinor: 300100n, basis: "cash", journalId: null, refDoc: "GRN", refNo: grn, postingDate: "2026-11-04" }]);
    expect(await memoOf(CASH, i)).toMatchObject([{ kind: "issue", totalMinor: 5000n, basis: "cash", journalId: null }]);
  });
  it("is idempotent: a redelivery records nothing twice", async () => {
    const r = randomUUID();
    await publish(CASH, receipt(r));
    await publish(CASH, receipt(r));
    expect(await memoOf(CASH, r)).toHaveLength(1);
  });
  it("acknowledges a re-driven dead letter the old generic path had inbox-marked (e6932aac shape), with no journal", async () => {
    const r = randomUUID(); const dead = randomUUID();
    msgIds.push(dead);
    await db.insert(processed).values({ messageId: dead });
    const before = q.dlq.length;
    await publish(CASH, { kind: "receipt", type: "inventory_movement", movementId: r, totalMinor: "300100" }, dead);
    expect(q.dlq.length).toBe(before);
    expect(await memoOf(CASH, r)).toMatchObject([{ basis: "cash", journalId: null, refDoc: null }]);
    expect(await journalsOfType(CASH)).toHaveLength(0);
  });
});

describe("accrual basis", () => {
  it("GRN receipt: Dr Stores 1400 / Cr GRNI 2080 (never the budget head), voucher from the AUTO series", async () => {
    const mv = randomUUID(); const grn = randomUUID();
    await publish(ACC, receipt(mv, { refDoc: "GRN", refNo: grn }));
    const [j] = await movementJournal(ACC, mv);
    expect(j).toMatchObject({ status: "posted", postingDate: "2026-11-04" });
    expect(await linesOf(ACC, j!.id)).toEqual([["1400", "300100", "0"], ["2080", "0", "300100"]].sort());
    expect(j!.voucherNo).not.toMatch(/^INV\//);
    expect(j!.voucherNo).not.toBe("AUTO");
    expect(j!.voucherNo).toMatch(/INVENTOR/); // the gapless series of the journal type
    expect(await memoOf(ACC, mv)).toMatchObject([{ basis: "accrual", journalId: j!.id }]);
  });

  it("the passed GRN bill clears GRNI to 0 (Dr GRNI / Cr the bill head), whichever arrives second, exactly once", async () => {
    const grnBalance0 = await balanceOf(ACC, "2080");
    const mv = randomUUID(); const grn = randomUUID();
    await publish(ACC, receipt(mv, { refDoc: "GRN", refNo: grn, totalMinor: "120000" }));
    expect(await balanceOf(ACC, "2080")).toBe(grnBalance0 - 120000n);
    // the bill is passed after the receipt (the bill-pass step calls clearGrniTx, payments/consumer.ts)
    await scoped(ACC, (tx) => tx.insert(financeBills).values({ id: randomUUID(), tenantId: ACC, billNo: `B-${grn.slice(0, 6)}`, vendorId: randomUUID(), headId: heads["2202"]!, grossMinor: 120000n, netMinor: 120000n, grnRef: `procurement_grn:${grn}`, billDate: "2026-11-05", stage: "pay", status: "passed", createdBy: ACTOR, updatedBy: ACTOR }));
    const outcome = await runWithTenant(ACC, () => db.transaction((tx) => clearGrniTx(tx, { tenantId: ACC, actorId: ACTOR, correlationId: "n6-bill" }, grn)));
    expect(outcome).toBe("enqueued");
    const clearId = deterministicId(`grni_clear:${grn}`);
    await relayJournal(ACC, clearId);
    expect(await linesOf(ACC, clearId)).toEqual([["2080", "120000", "0"], ["2202", "0", "120000"]].sort());
    expect(await balanceOf(ACC, "2080")).toBe(grnBalance0); // this GRN nets to 0 on GRNI
    // a second trigger (e.g. a redelivered bill pass) posts nothing more
    await runWithTenant(ACC, () => db.transaction((tx) => clearGrniTx(tx, { tenantId: ACC, actorId: ACTOR, correlationId: "n6-bill2" }, grn)));
    await relayJournal(ACC, clearId);
    expect(await linesOf(ACC, clearId)).toHaveLength(2);
    expect(await balanceOf(ACC, "2080")).toBe(grnBalance0);
  });

  it("a receipt whose bill is not passed yet waits (no clearing)", async () => {
    const mv = randomUUID(); const grn = randomUUID();
    await publish(ACC, receipt(mv, { refDoc: "GRN", refNo: grn }));
    expect(await runWithTenant(ACC, () => db.transaction((tx) => clearGrniTx(tx, { tenantId: ACC, actorId: ACTOR, correlationId: "n6-w" }, grn)))).toBe("waiting_for_bill");
  });

  it("manual receipt (no GRN): Dr Stores / Cr stores suspense 2085, never GRNI or the GRN bill head", async () => {
    const mv = randomUUID();
    await publish(ACC, receipt(mv, { refDoc: "OPENING", refNo: "OB-2026" }));
    const [j] = await movementJournal(ACC, mv);
    const lines = await linesOf(ACC, j!.id);
    expect(lines).toEqual([["1400", "300100", "0"], ["2085", "0", "300100"]].sort());
    expect(lines.some((l) => l[0] === "2202" || l[0] === "2080")).toBe(false);
  });

  it("issue: Dr the consuming head when the movement names one, else Stores consumed 5300 with a warning", async () => {
    const a = randomUUID(); const b = randomUUID();
    await publish(ACC, { type: "inventory_movement", movementId: a, kind: "issue", totalMinor: "5000", postingDate: "2026-11-04", expenseHeadCode: "2210" });
    await publish(ACC, { type: "inventory_movement", movementId: b, kind: "issue", totalMinor: "7000", postingDate: "2026-11-04" });
    expect(await linesOf(ACC, (await movementJournal(ACC, a))[0]!.id)).toEqual([["1400", "0", "5000"], ["2210", "5000", "0"]].sort());
    const jb = (await movementJournal(ACC, b))[0]!;
    expect(await linesOf(ACC, jb.id)).toEqual([["1400", "0", "7000"], ["5300", "7000", "0"]].sort());
    const warn = await scoped(ACC, (tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, ACC), sql`${outboxMessages.payload}->>${"code"} = ${"ISSUE_NO_CONSUMING_HEAD"}`, sql`${outboxMessages.payload}->>${"movementId"} = ${b}`)));
    expect(warn).toHaveLength(1);
  });

  it("is idempotent by journal id: a redelivery posts nothing more and burns no voucher number", async () => {
    const mv = randomUUID();
    await publish(ACC, receipt(mv, { refDoc: "GRN", refNo: randomUUID() }));
    const [first] = await movementJournal(ACC, mv);
    await publish(ACC, receipt(mv, { refDoc: "GRN", refNo: randomUUID() }));
    const rows = await movementJournal(ACC, mv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.voucherNo).toBe(first!.voucherNo);
  });

  it("holds a legacy receipt (no postingDate / refDoc) in the DLQ instead of guessing GRN vs non-GRN", async () => {
    const mv = randomUUID(); const before = q.dlq.length;
    await publish(ACC, { kind: "receipt", type: "inventory_movement", movementId: mv, totalMinor: "300100" });
    expect(q.dlq.length).toBe(before + 1);
    expect(await movementJournal(ACC, mv)).toHaveLength(0);
  });

  it("refuses a posting into a hard-closed period (period-open check), nothing posted", async () => {
    await scoped(ACC, (tx) => tx.insert(financePeriodClose).values({ tenantId: ACC, fiscalYear: "2025-26", period: "2026-03", status: "hard_close", createdBy: ACTOR }));
    const mv = randomUUID(); const before = q.dlq.length;
    await publish(ACC, receipt(mv, { postingDate: "2026-03-15", refDoc: "GRN", refNo: randomUUID() }));
    expect(q.dlq.length).toBe(before + 1);
    expect(await movementJournal(ACC, mv)).toHaveLength(0);
  });

  it("is tenant-scoped: an accrual journal is invisible to another tenant", async () => {
    const mv = randomUUID();
    await publish(ACC, receipt(mv, { refDoc: "GRN", refNo: randomUUID() }));
    expect(await movementJournal(CASH, mv)).toHaveLength(0);
  });
});

describe("payload errors", () => {
  it("dead-letters a payload that can never be recorded", async () => {
    const before = q.dlq.length;
    await publish(CASH, { type: "inventory_movement", kind: "receipt", totalMinor: "-5" });
    expect(q.dlq.length).toBe(before + 1);
  });
});
