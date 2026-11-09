/**
 * B22 (UAT 2026-11-09, numbers lane D5/D6), real Postgres:
 *  - D6: a 0/0 journal line is refused on a MANUAL journal (schema + create handler) and dropped when an automated
 *    producer sends one (an asset disposal with no accumulated depreciation), so it is never stored. 8 such lines sat
 *    on head 1250 (CONTRA/2026-27/000010-13, reversed DISP vouchers).
 *  - D5: gl.finance_ar_ledger had no writer; billing.invoice.issued / .paid now keep one AR row per invoice, so the
 *    AR sub-ledger ties to control account 1300 (which the same two events debit / credit).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeJournals, financeLedger } from "../src/modules/gl/schema.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { registerSubledgerConsumers } from "../src/modules/subledger/consumer.js";
import { postJournalBody } from "../src/modules/gl/validators.js";
import { COMMANDS } from "../src/topics.js";
import postgres from "postgres";
import { backfillStandardGlHeads } from "../scripts/backfill-standard-gl-heads.js";

function tenantWrappedQueue(opts?: { maxAttempts?: number }): MemoryQueue {
  const q = new MemoryQueue(opts);
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  return q;
}

const TENANT = "22b22b22-2222-4000-8000-0000000b2201";
const ACTOR = "00000000-bbbb-4000-8000-0000000b2202";
const CASH = randomUUID(), ASSET = randomUUID(), ACCUM = randomUUID(), GAIN = randomUUID();
afterAll(async () => { await sqlClient.end(); });

describe("D6: zero-amount journal lines", () => {
  it("the manual-journal schema refuses a 0/0 line next to real ones", () => {
    const body = {
      type: "contra", postingDate: new Date().toISOString().slice(0, 10), voucherNo: "AUTO",
      lines: [
        { accountCode: "1200", debitMinor: "1000000", creditMinor: "0" },
        { accountCode: "1250", debitMinor: "0", creditMinor: "0" },
        { accountCode: "1100", debitMinor: "0", creditMinor: "1000000" },
      ],
    };
    const r = postJournalBody.safeParse(body);
    expect(r.success).toBe(false);
    expect(JSON.stringify((r as { error: unknown }).error)).toMatch(/debit or a credit amount greater than zero/);
    expect(postJournalBody.safeParse({ ...body, lines: [body.lines[0], body.lines[2]] }).success).toBe(true);
  });

  it("finance.gl.create refuses a draft with a 0/0 line (JOURNAL_ZERO_LINE) and persists nothing", async () => {
    const q = tenantWrappedQueue({ maxAttempts: 1 });
    registerGlConsumers(q);
    await q.start();
    const id = randomUUID();
    await q.publish(COMMANDS.journalCreate, {
      messageId: randomUUID(), type: COMMANDS.journalCreate, tenantId: TENANT, actorId: ACTOR, correlationId: "corr-b22-zero", schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, voucherNo: "AUTO", type: "journal", postingDate: "2027-09-01", lines: [
        { accountCode: CASH, debitMinor: "500000", creditMinor: "0" },
        { accountCode: ACCUM, debitMinor: "0", creditMinor: "0" },
        { accountCode: GAIN, debitMinor: "0", creditMinor: "500000" },
      ] },
    });
    await q.drain();
    await q.stop();
    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]?.error).toMatch(/JOURNAL_ZERO_LINE/);
    expect((await scoped(TENANT, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, id)))).length).toBe(0);
  });

  it("an asset disposal with no accumulated depreciation posts without the 0/0 accumulated-depreciation leg", async () => {
    // The producer (gl/consumer.ts asset_disposal branch) always builds Dr 1250 accumulated depreciation; with
    // accumulatedDep = 0 that is the 0/0 line seen on head 1250 in UAT.
    const pg = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try { await backfillStandardGlHeads(pg, { dryRun: false, tenants: [TENANT] }); } finally { await pg.end({ timeout: 5 }); }
    // accrual basis: the cost and accumulated depreciation are written off (the cash basis posts only the proceeds receipt)
    await scoped(TENANT, (tx) => tx.execute(sql`INSERT INTO gl.finance_settings (tenant_id, accounting_basis, updated_by) VALUES (${TENANT}::uuid, 'accrual', ${ACTOR}::uuid) ON CONFLICT (tenant_id) DO UPDATE SET accounting_basis = 'accrual'`));
    const q = tenantWrappedQueue({ maxAttempts: 1 });
    registerGlConsumers(q);
    await q.start();
    const assetId = randomUUID();
    await q.publish(COMMANDS.journalPost, {
      messageId: randomUUID(), type: COMMANDS.journalPost, tenantId: TENANT, actorId: ACTOR, correlationId: "corr-b22-zero", schemaVersion: "1.0",
      payload: { type: "asset_disposal", assetId, acquisitionCost: "1000000", accumulatedDep: "0", proceeds: "80000", disposalDate: "2027-09-01" },
    });
    await q.drain();
    await q.stop();
    expect(q.dlq.length).toBe(0);
    const j = (await scoped(TENANT, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.voucherNo, `DISP/2027-09-01/${assetId.slice(0, 8)}`))))[0];
    expect(j?.status).toBe("posted");
    expect((j!.lines as unknown[]).length).toBe(3);
    const ledger = await scoped(TENANT, (tx) => tx.select().from(financeLedger).where(eq(financeLedger.voucherNo, j!.voucherNo)));
    expect(ledger.length).toBe(3);
    expect(ledger.some((l: { debitMinor: bigint; creditMinor: bigint }) => l.debitMinor === 0n && l.creditMinor === 0n)).toBe(false);
    const jl = await scoped(TENANT, (tx) => tx.execute(sql`SELECT COUNT(*)::int AS n FROM gl.finance_journal_lines WHERE journal_id = ${j!.id}::uuid AND debit_minor = 0 AND credit_minor = 0`));
    expect(((Array.isArray(jl) ? jl : (jl as { rows: unknown[] }).rows)[0] as { n: number }).n).toBe(0);
  });
});

describe("D5: AR sub-ledger is fed by billing invoice issued / paid", () => {
  const arTotal = async () => {
    const r = await scoped(TENANT, (tx) => tx.execute(sql`SELECT COALESCE(SUM(balance_minor),0)::bigint AS total, COUNT(*)::int AS n FROM gl.finance_ar_ledger WHERE tenant_id = ${TENANT}::uuid AND status <> 'paid'`));
    const row = (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows)[0] as { total: string; n: number };
    return { total: BigInt(row.total), n: row.n };
  };
  const publish = async (event: "issued" | "paid", invoiceId: string, totalMinor: string, messageId = randomUUID()) => {
    const q = tenantWrappedQueue({ maxAttempts: 1 });
    registerSubledgerConsumers(q);
    await q.start();
    await q.publish(COMMANDS.arLedgerSync, {
      messageId, type: COMMANDS.arLedgerSync, tenantId: TENANT, actorId: ACTOR, correlationId: "corr-b22-ar", schemaVersion: "1.0",
      payload: { event, invoiceId, totalMinor, date: "2026-11-02" },
    });
    await q.drain();
    await q.stop();
    expect(q.dlq.length).toBe(0);
  };

  it("issued opens a row at the invoice total; a replay under a new messageId does not double it; paid settles it", async () => {
    const before = await arTotal();
    const a = randomUUID(), b = randomUUID();
    await publish("issued", a, "250000");
    await publish("issued", a, "250000"); // replay, new messageId
    await publish("issued", b, "12345");
    let now = await arTotal();
    expect(now.total - before.total).toBe(262345n);
    expect(now.n - before.n).toBe(2);
    await publish("paid", a, "250000");
    now = await arTotal();
    expect(now.total - before.total).toBe(12345n);
    await publish("paid", a, "250000"); // replay: still settled once
    expect((await arTotal()).total - before.total).toBe(12345n);
  });

  it("a paid event with no earlier issued event records a settled row and leaves the open balance alone", async () => {
    const before = await arTotal();
    const c = randomUUID();
    await publish("paid", c, "99900");
    expect((await arTotal()).total).toBe(before.total);
    await publish("issued", c, "99900"); // late issued event must not reopen it
    expect((await arTotal()).total).toBe(before.total);
  });
});
