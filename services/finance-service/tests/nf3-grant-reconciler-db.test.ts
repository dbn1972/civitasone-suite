/**
 * Section 8 NF-3 B1(b), REAL Postgres: the finance.gl.rejected reconciler (grants/reconciler.ts, migration 0185).
 * Needs migrations 0170 + 0171 + 0172 + 0185 applied. Rejections are produced END TO END: a period closes between accept and post,
 * the real GL consumer refuses the journal and emits finance.gl.rejected, and that real event is fed to the reconciler.
 *
 *  1. a rejected grant posting writes exactly ONE void and reverts the grant state (totals/headroom, status, utilisation);
 *  2. re-delivery (same message id, a fresh message id, a second rejection after replay) writes no duplicate;
 *  3. a non-grant rejection, a flag-off (govt) tenant, a stale rejection (journal exists) are ignored;
 *  4. tenant RLS isolation on the new table; append-only; migration shape;
 *  5. a voided posting cannot be replayed (GRANT_POSTING_VOIDED) -- a new posting id re-drives it.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { purgeLedgerRows } from "./_purge-ledger.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { registerGrantReconciler } from "../src/modules/grants/reconciler.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { ensureGeneralFundTx } from "../src/modules/gl/funds.js";
import { GRANT_HEAD_CODES } from "../src/modules/gl/system-heads.js";
import {
  createGrantTx, getGrantTx, recordGrantReceiptTx, recogniseRevenueGrantTx, type CreateGrantInput,
} from "../src/modules/grants/service.js";

const MAKER = "00000000-0f31-4000-8000-0000000000a1";
const H = GRANT_HEAD_CODES();
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? r : (r as { rows: Record<string, unknown>[] }).rows);
const q1 = async (t: string, query: ReturnType<typeof sql>) => rowsOf(await scoped(t, (tx) => tx.execute(query)));
const meta = (t: string) => ({ tenantId: t, actorId: MAKER, correlationId: "corr-nf3-rec" });
const codeOf = async (p: Promise<unknown>): Promise<string> => { try { await p; return "NO_ERROR"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

const tenants: string[] = [];
afterAll(async () => {
  for (const t of tenants) await purgeLedgerRows(t, sql`true`).catch(() => undefined);
  await sqlClient.end();
});

const HEAD_DEFS: Array<[string, string]> = [
  ["1100", "asset"], [H.revenueReceiptSalary, "liability"], [H.revenueReceiptGeneral, "liability"], [H.capitalReceipt, "liability"],
  [H.capitalDeferred, "liability"], [H.capitalFund, "equity"], [H.revenueIncomeSalary, "income"], [H.revenueIncomeGeneral, "income"], [H.capitalRelease, "income"],
];
async function seedTenant(fundAccounting: boolean) {
  const t = randomUUID(); tenants.push(t);
  await scoped(t, (tx) => tx.insert(financeHeads).values(HEAD_DEFS.map(([code, classification]) => ({
    id: randomUUID(), tenantId: t, code, name: `Head ${code}`, level: 0, classification, createdBy: MAKER, updatedBy: MAKER,
  }))));
  await scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.finance_settings (tenant_id, budget_control, updated_by) VALUES (${t}::uuid, 'off', ${MAKER}::uuid)`));
  if (fundAccounting) {
    await scoped(t, (tx) => ensureGeneralFundTx(tx, t, MAKER));
    await scoped(t, (tx) => tx.execute(sql`UPDATE gl.finance_settings SET fund_accounting = true WHERE tenant_id = ${t}::uuid`));
  }
  return t;
}
async function newFund(t: string, code: string): Promise<string> {
  const id = randomUUID();
  await scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.funds (id, tenant_id, code, name, type, fcra, created_by, updated_by)
    VALUES (${id}::uuid, ${t}::uuid, ${code}, ${code}, 'restricted', false, ${MAKER}::uuid, ${MAKER}::uuid)`));
  return id;
}
const grantInput = (fundId: string, category: CreateGrantInput["category"], amountSanctionedMinor = 1_000n): CreateGrantInput => ({
  fundId, category, grantor: "Dept of Higher Education", schemeCode: "SCH-1", sanctionRef: `SAN/${randomUUID().slice(0, 8)}`, sanctionDate: "2026-04-01", amountSanctionedMinor,
});
const closePeriod = (t: string, period: string, status: string) => scoped(t, (tx) => tx.execute(sql`
  INSERT INTO gl.finance_period_close (tenant_id, fiscal_year, period, status, created_by)
  VALUES (${t}::uuid, '2026-27', ${period}, ${status}, ${MAKER}::uuid)
  ON CONFLICT (tenant_id, fiscal_year, period) DO UPDATE SET status = EXCLUDED.status`));
const count = async (t: string, table: string) => Number((await q1(t, sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE tenant_id = ${t}::uuid`))[0]?.n);

function tenantQueue(register: (q: MemoryQueue) => void): MemoryQueue {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    raw(topic, async (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  register(q);
  return q;
}
/** Publish every finance.gl.post the grant ops enqueued through the real GL consumer (refusals emit finance.gl.rejected to the outbox). */
async function drainGrantJournals(t: string): Promise<void> {
  // (a voided posting's original message is skipped: nothing re-sends it, and re-driving it by hand would resurrect a reversed posting)
  const msgs = rowsOf(await scoped(t, (tx) => tx.execute(sql`SELECT m.payload FROM _outbox.messages m
    WHERE m.tenant_id = ${t}::uuid AND m.topic = ${COMMANDS.journalPost}
      AND NOT EXISTS (SELECT 1 FROM gl.grant_posting_voids v WHERE v.tenant_id = m.tenant_id AND v.journal_id = (m.payload->>'id')::uuid)
    ORDER BY m.created_at, m.id`)));
  const q = tenantQueue((x) => registerGlConsumers(x));
  await q.start();
  for (const m of msgs) {
    await q.publish(COMMANDS.journalPost, {
      messageId: randomUUID(), type: COMMANDS.journalPost, tenantId: t, actorId: MAKER, correlationId: "corr-nf3-rec", schemaVersion: "1.0",
      payload: m.payload as Record<string, unknown>,
    });
  }
  await q.drain();
  await q.stop();
}
/** The REAL finance.gl.rejected payloads the GL consumer emitted for this tenant. */
const rejections = async (t: string) =>
  rowsOf(await scoped(t, (tx) => tx.execute(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${t}::uuid AND topic = ${EVENTS.glRejected} ORDER BY created_at, id`)))
    .map((r) => r.payload as Record<string, unknown>);
/** Deliver rejection payloads to the reconciler as tenant `as` (default: the owning tenant). */
async function reconcile(as: string, payloads: Record<string, unknown>[], messageId: () => string = randomUUID): Promise<void> {
  const q = tenantQueue((x) => registerGrantReconciler(x));
  await q.start();
  for (const p of payloads) {
    await q.publish(EVENTS.glRejected, { messageId: messageId(), type: EVENTS.glRejected, tenantId: as, actorId: MAKER, correlationId: "corr-nf3-rec", schemaVersion: "1.0", payload: p });
  }
  await q.drain();
  await q.stop();
}

describe("migration 0185: shape", () => {
  it("gl.grant_posting_voids: ENABLE + FORCE RLS with a tenant policy, idempotency unique key, composite FKs, append-only", async () => {
    const rls = rowsOf(await sqlClient`SELECT relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'gl' AND c.relname = 'grant_posting_voids'`);
    expect(rls[0]).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    const pol = rowsOf(await sqlClient`SELECT polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'gl' AND c.relname = 'grant_posting_voids'`);
    expect(pol.length).toBeGreaterThan(0);
    const cons = rowsOf(await sqlClient`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'gl.grant_posting_voids'::regclass`);
    expect(cons.find((c) => c.conname === "grant_posting_voids_journal_key")?.def).toMatch(/UNIQUE \(tenant_id, journal_id\)/);
    expect(cons.find((c) => c.conname === "grant_posting_voids_posting_fk")?.def).toMatch(/FOREIGN KEY \(tenant_id, journal_id\)/);
    expect(cons.find((c) => c.conname === "grant_posting_voids_grant_fk")?.def).toMatch(/FOREIGN KEY \(tenant_id, grant_id\)/);
  });
});

describe("a rejected grant receipt is voided and the grant state reverts", () => {
  it("writes exactly one void; totals/headroom, status and nothing else revert; the ledger never got the journal", async () => {
    const t = await seedTenant(true);
    const f = await newFund(t, "RECV");
    const g = await scoped(t, (tx) => createGrantTx(tx, meta(t), grantInput(f, "salary", 1_000n)));
    await scoped(t, (tx) => recordGrantReceiptTx(tx, meta(t), { grantId: g.id, amountMinor: 1_000n, postingDate: "2026-07-10" }));
    expect((await scoped(t, (tx) => getGrantTx(tx, t, g.id))).grant.status).toBe("active");
    await closePeriod(t, "2026-07", "hard_close");        // closes between accept and post
    await drainGrantJournals(t);
    expect(await count(t, "gl.finance_journals")).toBe(0);
    const rej = await rejections(t);
    expect(rej.length).toBe(1);

    await reconcile(t, rej);
    const voids = await q1(t, sql`SELECT kind, amount_minor::text AS amt, reject_code, needs_review FROM gl.grant_posting_voids WHERE tenant_id = ${t}::uuid`);
    expect(voids).toHaveLength(1);
    expect(voids[0]).toMatchObject({ kind: "receipt", amt: "1000", reject_code: "PERIOD_CLOSED", needs_review: false });
    const after = await scoped(t, (tx) => getGrantTx(tx, t, g.id));
    expect(after.totals.receipt).toBe(0n);
    expect(after.grant.status).toBe("sanctioned");
    expect(await count(t, "gl.grant_postings")).toBe(1);   // append-only trail untouched

    // headroom is back: the whole sanction can be received again (new posting id), once the period reopens
    await closePeriod(t, "2026-07", "open");
    await scoped(t, (tx) => recordGrantReceiptTx(tx, meta(t), { grantId: g.id, amountMinor: 1_000n, postingDate: "2026-07-10" }));
    await drainGrantJournals(t);
    expect(await count(t, "gl.finance_journals")).toBe(1);
    expect((await scoped(t, (tx) => getGrantTx(tx, t, g.id))).totals.receipt).toBe(1_000n);
  });

  it("re-delivery is idempotent: same message id, a fresh message id, and a second rejection after a replay all leave ONE void", async () => {
    const t = await seedTenant(true);
    const f = await newFund(t, "IDEMP");
    const g = await scoped(t, (tx) => createGrantTx(tx, meta(t), grantInput(f, "salary", 1_000n)));
    await scoped(t, (tx) => recordGrantReceiptTx(tx, meta(t), { grantId: g.id, amountMinor: 400n, postingDate: "2026-07-10" }));
    await closePeriod(t, "2026-07", "hard_close");
    await drainGrantJournals(t);
    const rej = await rejections(t);
    const fixed = randomUUID();
    await reconcile(t, rej, () => fixed);
    await reconcile(t, rej, () => fixed);           // exact redelivery (same message id)
    await reconcile(t, [...rej, ...rej]);           // fresh message ids, even twice in one go
    await drainGrantJournals(t);                    // the consumer refuses again -> a second gl.rejected for the same journal
    await reconcile(t, await rejections(t));
    expect(await count(t, "gl.grant_posting_voids")).toBe(1);
    expect((await scoped(t, (tx) => getGrantTx(tx, t, g.id))).totals.receipt).toBe(0n);
  });

  it("a voided posting cannot be replayed (GRANT_POSTING_VOIDED); a new posting id re-drives it", async () => {
    const t = await seedTenant(true);
    const f = await newFund(t, "NOREPLAY");
    const g = await scoped(t, (tx) => createGrantTx(tx, meta(t), grantInput(f, "salary", 1_000n)));
    const id = randomUUID();
    const input = { grantId: g.id, amountMinor: 300n, postingDate: "2026-07-10", id };
    await scoped(t, (tx) => recordGrantReceiptTx(tx, meta(t), input));
    await closePeriod(t, "2026-07", "hard_close");
    await drainGrantJournals(t);
    await reconcile(t, await rejections(t));
    await closePeriod(t, "2026-07", "open");
    expect(await codeOf(scoped(t, (tx) => recordGrantReceiptTx(tx, meta(t), input)))).toBe("GRANT_POSTING_VOIDED");
    await scoped(t, (tx) => recordGrantReceiptTx(tx, meta(t), { ...input, id: randomUUID() }));
    await drainGrantJournals(t);
    expect(await count(t, "gl.finance_journals")).toBe(1);
    expect(await count(t, "gl.grant_posting_voids")).toBe(1);
  });
});

describe("a rejected recognition reverts utilisation, keeps the grant active", () => {
  it("amount_utilised and unspent go back; the earlier receipt (posted) stays; status stays active", async () => {
    const t = await seedTenant(true);
    const f = await newFund(t, "RECOG");
    const g = await scoped(t, (tx) => createGrantTx(tx, meta(t), grantInput(f, "general", 1_000n)));
    await scoped(t, (tx) => recordGrantReceiptTx(tx, meta(t), { grantId: g.id, amountMinor: 1_000n, postingDate: "2026-07-10" }));
    await drainGrantJournals(t);                                  // receipt posts
    await scoped(t, (tx) => recogniseRevenueGrantTx(tx, meta(t), { grantId: g.id, amountMinor: 250n, postingDate: "2026-08-10" }));
    await closePeriod(t, "2026-08", "hard_close");
    await drainGrantJournals(t);                                  // recognition refused
    const rej = await rejections(t);
    expect(rej.length).toBe(1);
    await reconcile(t, rej);
    const util = await q1(t, sql`SELECT amount_utilised_minor::text AS used, unspent_balance_minor::text AS unspent FROM gl.grant_utilisation WHERE tenant_id = ${t}::uuid AND period = '2026-08'`);
    expect(util[0]).toMatchObject({ used: "0", unspent: "1000" });
    const after = await scoped(t, (tx) => getGrantTx(tx, t, g.id));
    expect(after.totals).toMatchObject({ receipt: 1_000n, recognition: 0n });
    expect(after.unspentMinor).toBe(1_000n);
    expect(after.grant.status).toBe("active");
    expect(await q1(t, sql`SELECT kind FROM gl.grant_posting_voids WHERE tenant_id = ${t}::uuid`)).toEqual([{ kind: "recognition" }]);
  });

  it("voiding a receipt that a live recognition leaned on sets needs_review", async () => {
    const t = await seedTenant(true);
    const f = await newFund(t, "LEAN");
    const g = await scoped(t, (tx) => createGrantTx(tx, meta(t), grantInput(f, "general", 1_000n)));
    await scoped(t, (tx) => recordGrantReceiptTx(tx, meta(t), { grantId: g.id, amountMinor: 500n, postingDate: "2026-07-10" }));
    await scoped(t, (tx) => recogniseRevenueGrantTx(tx, meta(t), { grantId: g.id, amountMinor: 200n, postingDate: "2026-08-10" }));
    await closePeriod(t, "2026-07", "hard_close");
    await drainGrantJournals(t);
    await reconcile(t, await rejections(t));
    expect(await q1(t, sql`SELECT kind, needs_review FROM gl.grant_posting_voids WHERE tenant_id = ${t}::uuid`)).toEqual([{ kind: "receipt", needs_review: true }]);
  });
});

describe("what the reconciler ignores", () => {
  it("a non-grant rejection (unknown journal id, no journal id, malformed) writes nothing", async () => {
    const t = await seedTenant(true);
    const f = await newFund(t, "NONGRANT");
    const g = await scoped(t, (tx) => createGrantTx(tx, meta(t), grantInput(f, "salary", 1_000n)));
    await scoped(t, (tx) => recordGrantReceiptTx(tx, meta(t), { grantId: g.id, amountMinor: 100n, postingDate: "2026-07-10" }));
    await reconcile(t, [
      { journalId: randomUUID(), code: "PERIOD_CLOSED", reason: "x", type: "journal" },
      { code: "UNKNOWN_ACCOUNT_CODE", reason: "no id" },
      { journalId: 42, code: "X" },
    ]);
    expect(await count(t, "gl.grant_posting_voids")).toBe(0);
    expect((await scoped(t, (tx) => getGrantTx(tx, t, g.id))).totals.receipt).toBe(100n);
  });

  it("a flag-off (govt) tenant is ignored: no void, no state change", async () => {
    const t = await seedTenant(false);
    await reconcile(t, [{ journalId: randomUUID(), code: "PERIOD_CLOSED", reason: "x" }]);
    expect(await count(t, "gl.grant_posting_voids")).toBe(0);
    expect(await count(t, "gl.grants")).toBe(0);
  });

  it("a stale rejection (the journal actually exists in the ledger) is ignored", async () => {
    const t = await seedTenant(true);
    const f = await newFund(t, "STALE");
    const g = await scoped(t, (tx) => createGrantTx(tx, meta(t), grantInput(f, "salary", 1_000n)));
    const r = await scoped(t, (tx) => recordGrantReceiptTx(tx, meta(t), { grantId: g.id, amountMinor: 100n, postingDate: "2026-07-10" }));
    await drainGrantJournals(t);
    expect(await count(t, "gl.finance_journals")).toBe(1);
    await reconcile(t, [{ journalId: r.journalId, code: "PERIOD_CLOSED", reason: "late duplicate" }]);
    expect(await count(t, "gl.grant_posting_voids")).toBe(0);
    expect((await scoped(t, (tx) => getGrantTx(tx, t, g.id))).totals.receipt).toBe(100n);
  });
});

describe("tenant isolation (RLS)", () => {
  it("tenant B delivering A's journal id voids nothing; B cannot read A's voids; A's void is unaffected", async () => {
    const a = await seedTenant(true);
    const b = await seedTenant(true);
    const f = await newFund(a, "ISO");
    const g = await scoped(a, (tx) => createGrantTx(tx, meta(a), grantInput(f, "salary", 1_000n)));
    const r = await scoped(a, (tx) => recordGrantReceiptTx(tx, meta(a), { grantId: g.id, amountMinor: 100n, postingDate: "2026-07-10" }));
    await closePeriod(a, "2026-07", "hard_close");
    await drainGrantJournals(a);

    await reconcile(b, [{ journalId: r.journalId, code: "PERIOD_CLOSED", reason: "wrong tenant" }]);
    expect(await count(a, "gl.grant_posting_voids")).toBe(0);
    expect((await scoped(a, (tx) => getGrantTx(tx, a, g.id))).totals.receipt).toBe(100n);

    await reconcile(a, await rejections(a));
    expect(await count(a, "gl.grant_posting_voids")).toBe(1);
    expect(await count(b, "gl.grant_posting_voids")).toBe(0);
    expect(rowsOf(await scoped(b, (tx) => tx.execute(sql`SELECT 1 FROM gl.grant_posting_voids`)))).toHaveLength(0);
  });

  it("the void trail is append-only", async () => {
    const t = await seedTenant(true);
    const f = await newFund(t, "APPEND");
    const g = await scoped(t, (tx) => createGrantTx(tx, meta(t), grantInput(f, "salary", 1_000n)));
    await scoped(t, (tx) => recordGrantReceiptTx(tx, meta(t), { grantId: g.id, amountMinor: 100n, postingDate: "2026-07-10" }));
    await closePeriod(t, "2026-07", "hard_close");
    await drainGrantJournals(t);
    await reconcile(t, await rejections(t));
    await expect(scoped(t, (tx) => tx.execute(sql`UPDATE gl.grant_posting_voids SET needs_review = true WHERE tenant_id = ${t}::uuid`))).rejects.toThrow();
    await expect(scoped(t, (tx) => tx.execute(sql`DELETE FROM gl.grant_posting_voids WHERE tenant_id = ${t}::uuid`))).rejects.toThrow();
  });
});
