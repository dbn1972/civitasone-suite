/**
 * Section 8 NF-1, REAL Postgres (the orchestrator runs this on a throwaway database; the author does not).
 * Design: docs/design/SECTION8-NONPROFIT-FINANCE.md §2.3, §2.4, §2.5, §9. Needs migration 0171 applied.
 *
 *  1. migration shape: gl.funds + RLS (ENABLE + FORCE + policy), nullable fund_id columns, composite FKs VALIDATED, the opening-
 *     balance unique index, the partial indexes, triggers and functions; gl.finance_ledger still append-only and accepts fund_id;
 *     old rows unchanged.
 *  2. cross-tenant: tenant B cannot see tenant A's funds, and cannot reference them through the composite FK.
 *  3. the deferred per-(journal, fund) constraint: a strict no-op for NULL-fund (govt) lines, enforced for fund-tagged lines.
 *  4. posting through the seam: OFF writes no fund anywhere; ON tags JSONB + journal lines + ledger identically (default GENERAL);
 *     ON without a GENERAL fund is refused and writes nothing.
 *  5. fund trial balance nets to zero per fund; inter-fund transfer and release (maker-checker) net to zero.
 *  6. restricted overspend is refused, including under concurrency (fund row lock).
 *  7. fund_accounting flip guards, fund immutability, simplified-writer refusal, per-fund year-end, cash book, opening balances.
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
import { COMMANDS } from "../src/topics.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeLedger } from "../src/modules/gl/schema.js";
import { ensureGeneralFundTx, fundBalanceTx, FUND_HEADS } from "../src/modules/gl/funds.js";
import { fundContext, assertFundAccountingOffTx } from "../src/modules/gl/fund-context.js";
import { fundYearEndRollover } from "../src/modules/year-end/fund-repo.js";
import { postCashBook } from "../src/shared/cashbook.js";
import { buildApp } from "../src/app.js";
import { bearer } from "./_fp02.js";

const MAKER = "00000000-0f11-4000-8000-0000000000a1";
const CHECKER = "00000000-0f11-4000-8000-0000000000a2";
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? r : (r as { rows: Record<string, unknown>[] }).rows);
const q1 = async (t: string, query: ReturnType<typeof sql>) => rowsOf(await scoped(t, (tx) => tx.execute(query)));

const tenants: string[] = [];
const newTenant = () => { const t = randomUUID(); tenants.push(t); return t; };
afterAll(async () => {
  for (const t of tenants) await purgeLedgerRows(t, sql`true`).catch(() => undefined);
  await sqlClient.end();
});

const head = (t: string, code: string, classification: string) => ({
  id: randomUUID(), tenantId: t, code, name: `Head ${code}`, level: 0, classification, createdBy: MAKER, updatedBy: MAKER,
});
const HEAD_DEFS: Array<[string, string]> = [
  ["1100", "asset"], ["4100", "income"], ["5100", "expense"], ["3100", "equity"],
  [FUND_HEADS.dueFrom, "asset"], [FUND_HEADS.dueTo, "liability"],
  [FUND_HEADS.transferOut, "equity"], [FUND_HEADS.transferIn, "equity"], [FUND_HEADS.releaseOut, "equity"], [FUND_HEADS.releaseIn, "equity"],
];
async function seedTenant(opts: { fundAccounting: boolean; general?: boolean }) {
  const t = newTenant();
  const heads = new Map(HEAD_DEFS.map(([c, k]) => [c, head(t, c, k)]));
  await scoped(t, (tx) => tx.insert(financeHeads).values([...heads.values()]));
  // budget control off: these tests are about funds, not provisions
  await scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.finance_settings (tenant_id, budget_control, updated_by) VALUES (${t}::uuid, 'off', ${MAKER}::uuid)`));
  let general: string | null = null;
  if (opts.fundAccounting) {
    if (opts.general !== false) general = await scoped(t, (tx) => ensureGeneralFundTx(tx, t, MAKER));
    await scoped(t, (tx) => tx.execute(sql`UPDATE gl.finance_settings SET fund_accounting = true WHERE tenant_id = ${t}::uuid`));
  }
  return { t, heads, general };
}
async function newFund(t: string, code: string, type: "corpus" | "restricted" | "unrestricted" | "designated", fcra = false): Promise<string> {
  const id = randomUUID();
  await scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.funds (id, tenant_id, code, name, type, fcra, created_by, updated_by)
    VALUES (${id}::uuid, ${t}::uuid, ${code}, ${code}, ${type}, ${fcra}, ${MAKER}::uuid, ${MAKER}::uuid)`));
  return id;
}
/** Seed a fund balance directly in the (append-only) ledger: income credited to the fund, cash debited to it. */
async function seedFundBalance(s: Awaited<ReturnType<typeof seedTenant>>, fundId: string, amountMinor: bigint, date = "2026-05-02") {
  const l = (code: string, d: bigint, c: bigint) => ({
    tenantId: s.t, headId: (s.heads.get(code) as { id: string }).id, voucherNo: `SEED-${randomUUID().slice(0, 8)}`, postingDate: date,
    debitMinor: d, creditMinor: c, balanceMinor: d - c, createdBy: MAKER, updatedBy: MAKER, fundId,
  });
  await scoped(s.t, (tx) => tx.insert(financeLedger).values([l("1100", amountMinor, 0n), l("4100", 0n, amountMinor)]));
}

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    raw(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  return q;
}
type L = { accountCode: string; debitMinor: bigint; creditMinor: bigint; fundId?: string };
const dr = (accountCode: string, amt: bigint, fundId?: string): L => ({ accountCode, debitMinor: amt, creditMinor: 0n, ...(fundId ? { fundId } : {}) });
const cr = (accountCode: string, amt: bigint, fundId?: string): L => ({ accountCode, debitMinor: 0n, creditMinor: amt, ...(fundId ? { fundId } : {}) });

/** Post a journal straight through finance.gl.post; resolves to the number of dead-lettered messages. */
async function post(t: string, lines: L[], type = "journal", date = "2026-08-10"): Promise<number> {
  const q = tenantWrappedQueue();
  registerGlConsumers(q);
  await q.start();
  await q.publish(COMMANDS.journalPost, {
    messageId: randomUUID(), type: COMMANDS.journalPost, tenantId: t, actorId: MAKER, correlationId: "corr-nf1", schemaVersion: "1.0",
    payload: { id: randomUUID(), tenantId: t, voucherNo: `NF1-${randomUUID().slice(0, 8)}`, type, postingDate: date, lines },
  });
  await q.drain();
  await q.stop();
  return q.dlq.length;
}
/** Maker drafts, a distinct checker approves: the transfer / release flow. Returns dead-letter count. */
async function draftAndApprove(t: string, type: string, lines: L[]): Promise<number> {
  const q = tenantWrappedQueue();
  registerGlConsumers(q);
  await q.start();
  const id = randomUUID();
  await q.publish(COMMANDS.journalCreate, {
    messageId: id, type: COMMANDS.journalCreate, tenantId: t, actorId: MAKER, correlationId: "corr-nf1", schemaVersion: "1.0",
    payload: { id, tenantId: t, voucherNo: "AUTO", type, postingDate: "2026-08-10", lines, budgetOverride: false },
  });
  await q.drain();
  await q.publish(COMMANDS.journalApprove, {
    messageId: randomUUID(), type: COMMANDS.journalApprove, tenantId: t, actorId: CHECKER, correlationId: "corr-nf1", schemaVersion: "1.0",
    payload: { id, tenantId: t },
  });
  await q.drain();
  await q.stop();
  return q.dlq.length;
}
const ledgerCount = async (t: string) => Number((await q1(t, sql`SELECT count(*)::int AS n FROM gl.finance_ledger WHERE tenant_id = ${t}::uuid`))[0]?.n);
const perFundNet = async (t: string) => q1(t, sql`SELECT fund_id::text AS fund_id, SUM(debit_minor - credit_minor)::text AS net FROM gl.finance_ledger WHERE tenant_id = ${t}::uuid GROUP BY fund_id ORDER BY fund_id`);

describe("migration 0171: shape", () => {
  it("gl.funds has the design columns, CHECKs, UNIQUEs, and ENABLE + FORCE row level security with the tenant policy", async () => {
    const cols = rowsOf(await sqlClient`SELECT column_name FROM information_schema.columns WHERE table_schema = 'gl' AND table_name = 'funds'`).map((r) => r.column_name);
    for (const c of ["id", "tenant_id", "code", "name", "type", "fcra", "source_condition", "status"]) expect(cols).toContain(c);
    const rls = rowsOf(await sqlClient`SELECT relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'gl' AND c.relname = 'funds'`);
    expect(rls[0]).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    const pol = rowsOf(await sqlClient`SELECT polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relname = 'funds'`);
    expect(pol.length).toBeGreaterThan(0);
    const cons = rowsOf(await sqlClient`SELECT conname, contype FROM pg_constraint WHERE conrelid = 'gl.funds'::regclass`).map((r) => `${r.contype}:${r.conname}`);
    expect(cons).toEqual(expect.arrayContaining(["c:funds_type_check", "c:funds_status_check", "u:funds_tenant_id_id_key", "u:funds_tenant_id_code_key"]));
  });
  it("fund_id is a NULLABLE uuid on the four books; the composite tenant-scoped FKs exist and are VALIDATED", async () => {
    for (const tbl of ["finance_ledger", "finance_journal_lines", "finance_opening_balances", "finance_cash_book"]) {
      const c = rowsOf(await sqlClient`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'gl' AND table_name = ${tbl} AND column_name = 'fund_id'`);
      expect(c[0], tbl).toMatchObject({ data_type: "uuid", is_nullable: "YES" });
    }
    const fks = rowsOf(await sqlClient`SELECT conname, convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname LIKE '%_fund_fk'`);
    expect(fks.length).toBe(4);
    for (const f of fks) {
      expect(f.convalidated, String(f.conname)).toBe(true);
      expect(String(f.def)).toMatch(/FOREIGN KEY \(tenant_id, fund_id\) REFERENCES gl\.funds\(tenant_id, id\)/);
    }
  });
  it("opening balances: the old (tenant, fy, account) UNIQUE is gone, replaced by a fund-aware unique index", async () => {
    const old = rowsOf(await sqlClient`SELECT conname FROM pg_constraint WHERE conrelid = 'gl.finance_opening_balances'::regclass AND contype = 'u'`);
    expect(old).toEqual([]);
    const idx = rowsOf(await sqlClient`SELECT indexdef FROM pg_indexes WHERE schemaname = 'gl' AND indexname = 'uq_opening_balances_tenant_fy_account_fund'`);
    expect(String(idx[0]?.indexdef)).toMatch(/UNIQUE.*COALESCE\(fund_id/);
  });
  it("the indexes are PARTIAL (WHERE fund_id IS NOT NULL) and there is no plain (tenant_id, fund_id) index", async () => {
    const idx = rowsOf(await sqlClient`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'gl' AND tablename IN ('finance_ledger', 'finance_journal_lines') AND indexdef ILIKE '%fund_id%'`);
    expect(idx.length).toBe(2);
    for (const i of idx) {
      expect(String(i.indexdef)).toMatch(/\(tenant_id, fund_id, head_id, posting_date\) WHERE \(fund_id IS NOT NULL\)/);
    }
    // and no table named fund_balances (balances are computed on read)
    const fb = rowsOf(await sqlClient`SELECT 1 FROM information_schema.tables WHERE table_schema = 'gl' AND table_name = 'fund_balances'`);
    expect(fb.length).toBe(0);
  });
  it("the functions and triggers exist", async () => {
    const fns = rowsOf(await sqlClient`SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'gl'`).map((r) => r.proname);
    for (const f of ["check_journal_balance", "general_fund_id", "resolve_fund", "tag_fund_id", "guard_fund_immutable", "guard_fund_accounting_flip"]) expect(fns).toContain(f);
    const trg = rowsOf(await sqlClient`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`).map((r) => r.tgname);
    for (const g of ["trg_fund_immutable", "trg_fund_accounting_flip", "trg_opening_balances_fund", "trg_cash_book_fund", "trg_journal_lines_balanced", "trg_ledger_no_mutate"]) expect(trg).toContain(g);
  });
});

describe("finance_ledger stays append-only and accepts fund_id; old rows are unchanged", () => {
  it("a row with fund_id inserts; a pre-existing NULL-fund row is untouched; UPDATE / DELETE are still refused", async () => {
    const s = await seedTenant({ fundAccounting: false });
    const old = { tenantId: s.t, headId: (s.heads.get("1100") as { id: string }).id, voucherNo: "OLD-1", postingDate: "2026-05-02", debitMinor: 5n, creditMinor: 0n, balanceMinor: 5n, createdBy: MAKER, updatedBy: MAKER };
    await scoped(s.t, (tx) => tx.insert(financeLedger).values(old));
    const f = await newFund(s.t, "F1", "restricted");
    await scoped(s.t, (tx) => tx.insert(financeLedger).values({ ...old, voucherNo: "NEW-1", fundId: f }));
    const rows = await q1(s.t, sql`SELECT voucher_no, fund_id::text AS fund_id FROM gl.finance_ledger WHERE tenant_id = ${s.t}::uuid ORDER BY voucher_no`);
    expect(rows).toEqual([{ voucher_no: "NEW-1", fund_id: f }, { voucher_no: "OLD-1", fund_id: null }]);
    await expect(scoped(s.t, (tx) => tx.execute(sql`UPDATE gl.finance_ledger SET fund_id = NULL WHERE tenant_id = ${s.t}::uuid`))).rejects.toThrow(/append-only/);
    await expect(scoped(s.t, (tx) => tx.execute(sql`DELETE FROM gl.finance_ledger WHERE tenant_id = ${s.t}::uuid`))).rejects.toThrow();
  });
});

describe("cross-tenant isolation of gl.funds (RLS + composite FK)", () => {
  it("tenant B cannot read tenant A's funds, cannot write a fund for A, and cannot reference A's fund from a ledger row", async () => {
    const a = await seedTenant({ fundAccounting: true });
    const b = await seedTenant({ fundAccounting: true });
    const fa = await newFund(a.t, "A-ONLY", "restricted");
    expect((await q1(b.t, sql`SELECT id FROM gl.funds WHERE id = ${fa}::uuid`)).length).toBe(0);
    expect((await q1(a.t, sql`SELECT id FROM gl.funds WHERE id = ${fa}::uuid`)).length).toBe(1);
    await expect(scoped(b.t, (tx) => tx.execute(sql`INSERT INTO gl.funds (tenant_id, code, name, type, created_by, updated_by) VALUES (${a.t}::uuid, 'X', 'X', 'restricted', ${MAKER}::uuid, ${MAKER}::uuid)`))).rejects.toThrow();
    const row = { tenantId: b.t, headId: (b.heads.get("1100") as { id: string }).id, voucherNo: "XT-1", postingDate: "2026-05-02", debitMinor: 1n, creditMinor: 0n, balanceMinor: 1n, createdBy: MAKER, updatedBy: MAKER, fundId: fa };
    await expect(scoped(b.t, (tx) => tx.insert(financeLedger).values(row))).rejects.toThrow(/foreign key|violates/i);
  });
});

describe("deferred per-(journal, fund) balance constraint (extends 0072b)", () => {
  const insJournalAndLines = (t: string, lines: Array<{ head: string; d: bigint; c: bigint; fund: string | null }>) => scoped(t, async (tx) => {
    const jid = randomUUID();
    await tx.execute(sql`INSERT INTO gl.finance_journals (id, tenant_id, voucher_no, type, posting_date, lines, status, created_by, updated_by)
      VALUES (${jid}::uuid, ${t}::uuid, ${`V-${jid.slice(0, 8)}`}, 'journal', '2026-08-10', '[]'::jsonb, 'posted', ${MAKER}::uuid, ${MAKER}::uuid)`);
    for (const l of lines) {
      await tx.execute(sql`INSERT INTO gl.finance_journal_lines (tenant_id, journal_id, head_id, debit_minor, credit_minor, posting_date, journal_type, fund_id)
        VALUES (${t}::uuid, ${jid}::uuid, ${l.head}::uuid, ${l.d.toString()}::bigint, ${l.c.toString()}::bigint, '2026-08-10', 'journal', ${l.fund}::uuid)`);
    }
  });
  it("NULL-fund (govt) lines: a balanced journal passes and an overall-unbalanced one still fails -- exactly the 0072b behaviour", async () => {
    const s = await seedTenant({ fundAccounting: false });
    const h1 = (s.heads.get("1100") as { id: string }).id, h2 = (s.heads.get("4100") as { id: string }).id;
    await insJournalAndLines(s.t, [{ head: h1, d: 100n, c: 0n, fund: null }, { head: h2, d: 0n, c: 100n, fund: null }]);
    await expect(insJournalAndLines(s.t, [{ head: h1, d: 100n, c: 0n, fund: null }, { head: h2, d: 0n, c: 90n, fund: null }])).rejects.toThrow(/JOURNAL_UNBALANCED/);
  });
  it("fund-tagged lines: balanced overall but unbalanced within a fund is refused; balanced within each fund passes", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f1 = await newFund(s.t, "F1", "restricted"), f2 = await newFund(s.t, "F2", "unrestricted");
    const h1 = (s.heads.get("1100") as { id: string }).id, h2 = (s.heads.get("4100") as { id: string }).id;
    await expect(insJournalAndLines(s.t, [{ head: h1, d: 100n, c: 0n, fund: f1 }, { head: h2, d: 0n, c: 100n, fund: f2 }])).rejects.toThrow(/JOURNAL_FUND_UNBALANCED/);
    await insJournalAndLines(s.t, [
      { head: h1, d: 100n, c: 0n, fund: f1 }, { head: h2, d: 0n, c: 100n, fund: f1 },
      { head: h1, d: 40n, c: 0n, fund: f2 }, { head: h2, d: 0n, c: 40n, fund: f2 },
    ]);
  });
});

describe("posting through the seam", () => {
  it("OFF: no fund anywhere -- ledger and journal-line fund_id NULL, JSONB elements carry no fundId", async () => {
    const s = await seedTenant({ fundAccounting: false });
    expect(await post(s.t, [dr("1100", 700n), cr("4100", 700n)])).toBe(0);
    expect(await q1(s.t, sql`SELECT count(*)::int AS n FROM gl.finance_ledger WHERE tenant_id = ${s.t}::uuid AND fund_id IS NOT NULL`)).toEqual([{ n: 0 }]);
    expect(await q1(s.t, sql`SELECT count(*)::int AS n FROM gl.finance_journal_lines WHERE tenant_id = ${s.t}::uuid AND fund_id IS NOT NULL`)).toEqual([{ n: 0 }]);
    const j = await q1(s.t, sql`SELECT lines FROM gl.finance_journals WHERE tenant_id = ${s.t}::uuid`);
    expect(JSON.stringify(j[0]?.lines)).not.toContain("fundId");
    expect(await ledgerCount(s.t)).toBe(2);
  });
  it("ON: ledger, journal lines and the JSONB element are tagged from the SAME source; unnamed lines default to GENERAL", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const r = await newFund(s.t, "R1", "restricted");
    expect(await post(s.t, [dr("1100", 300n, r), cr("4100", 300n, r), dr("1100", 50n), cr("4100", 50n)])).toBe(0);
    const led = await q1(s.t, sql`SELECT fund_id::text AS f, SUM(debit_minor)::text AS d FROM gl.finance_ledger WHERE tenant_id = ${s.t}::uuid GROUP BY fund_id ORDER BY SUM(debit_minor)`);
    expect(led).toEqual([{ f: s.general, d: "50" }, { f: r, d: "300" }]);
    const jl = await q1(s.t, sql`SELECT fund_id::text AS f, SUM(debit_minor)::text AS d FROM gl.finance_journal_lines WHERE tenant_id = ${s.t}::uuid GROUP BY fund_id ORDER BY SUM(debit_minor)`);
    expect(jl).toEqual(led);
    const j = await q1(s.t, sql`SELECT lines FROM gl.finance_journals WHERE tenant_id = ${s.t}::uuid`);
    const funds = (j[0]?.lines as Array<{ fundId: string }>).map((l) => l.fundId).sort();
    expect(funds).toEqual([s.general, s.general, r, r].sort());
  });
  it("fail-closed: ON without a GENERAL fund refuses to post and writes NOTHING (no untagged fallback)", async () => {
    const s = await seedTenant({ fundAccounting: true, general: false });
    expect(await post(s.t, [dr("1100", 10n), cr("4100", 10n)])).toBe(1);
    expect(await ledgerCount(s.t)).toBe(0);
    expect((await q1(s.t, sql`SELECT count(*)::int AS n FROM gl.finance_journals WHERE tenant_id = ${s.t}::uuid`))[0]?.n).toBe(0);
  });
  it("a line that names a fund while fund accounting is OFF is refused and writes nothing", async () => {
    const s = await seedTenant({ fundAccounting: false });
    const other = await seedTenant({ fundAccounting: true });
    const f = await newFund(other.t, "ELSEWHERE", "restricted");
    expect(await post(s.t, [dr("1100", 10n, f), cr("4100", 10n, f)])).toBe(1);
    expect(await ledgerCount(s.t)).toBe(0);
  });
  it("a journal that is unbalanced within a fund is refused at posting and writes nothing", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const r = await newFund(s.t, "R1", "restricted");
    expect(await post(s.t, [dr("1100", 100n, r), cr("4100", 100n)])).toBe(1); // balances overall, not within R / GENERAL
    expect(await ledgerCount(s.t)).toBe(0);
  });
});

describe("fund trial balance, inter-fund transfer and release (maker-checker)", () => {
  it("every fund's trial balance nets to zero after ordinary postings", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const r = await newFund(s.t, "R1", "restricted");
    expect(await post(s.t, [dr("1100", 900n, r), cr("4100", 900n, r)])).toBe(0);
    expect(await post(s.t, [dr("5100", 250n, r), cr("1100", 250n, r)])).toBe(0);
    expect(await post(s.t, [dr("1100", 77n), cr("4100", 77n)])).toBe(0);
    for (const row of await perFundNet(s.t)) expect(row.net, String(row.fund_id)).toBe("0");
  });
  it("an inter-fund transfer drafted by the maker and approved by a distinct checker nets to zero per fund and in total", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const a = await newFund(s.t, "A1", "unrestricted"), b = await newFund(s.t, "B1", "designated");
    await seedFundBalance(s, a, 5_000n);
    const lines: L[] = [
      dr(FUND_HEADS.transferOut, 1_200n, a), cr(FUND_HEADS.dueTo, 1_200n, a),
      dr(FUND_HEADS.dueFrom, 1_200n, b), cr(FUND_HEADS.transferIn, 1_200n, b),
    ];
    expect(await draftAndApprove(s.t, "fund_transfer", lines)).toBe(0);
    const posted = await q1(s.t, sql`SELECT status FROM gl.finance_journals WHERE tenant_id = ${s.t}::uuid AND type = 'fund_transfer'`);
    expect(posted).toEqual([{ status: "posted" }]);
    for (const row of await perFundNet(s.t)) expect(row.net, String(row.fund_id)).toBe("0");
    const total = await q1(s.t, sql`SELECT SUM(debit_minor - credit_minor)::text AS n FROM gl.finance_ledger WHERE tenant_id = ${s.t}::uuid`);
    expect(total[0]?.n).toBe("0");
    // the due-to / due-from pair eliminates across funds
    const pair = await q1(s.t, sql`SELECT SUM(fl.debit_minor - fl.credit_minor)::text AS n FROM gl.finance_ledger fl JOIN budget.finance_heads h ON h.id = fl.head_id
      WHERE fl.tenant_id = ${s.t}::uuid AND h.code IN (${FUND_HEADS.dueTo}, ${FUND_HEADS.dueFrom})`);
    expect(pair[0]?.n).toBe("0");
    expect(await scoped(s.t, (tx) => fundBalanceTx(tx, s.t, a))).toBe(5_000n - 1_200n);
    expect(await scoped(s.t, (tx) => fundBalanceTx(tx, s.t, b))).toBe(1_200n);
  });
  it("the same officer cannot approve their own transfer", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const a = await newFund(s.t, "A1", "unrestricted"), b = await newFund(s.t, "B1", "unrestricted");
    const lines: L[] = [dr(FUND_HEADS.transferOut, 5n, a), cr(FUND_HEADS.dueTo, 5n, a), dr(FUND_HEADS.dueFrom, 5n, b), cr(FUND_HEADS.transferIn, 5n, b)];
    const q = tenantWrappedQueue(); registerGlConsumers(q); await q.start();
    const id = randomUUID();
    await q.publish(COMMANDS.journalCreate, { messageId: id, type: COMMANDS.journalCreate, tenantId: s.t, actorId: MAKER, correlationId: "c", schemaVersion: "1.0",
      payload: { id, tenantId: s.t, voucherNo: "AUTO", type: "fund_transfer", postingDate: "2026-08-10", lines, budgetOverride: false } });
    await q.drain();
    await q.publish(COMMANDS.journalApprove, { messageId: randomUUID(), type: COMMANDS.journalApprove, tenantId: s.t, actorId: MAKER, correlationId: "c", schemaVersion: "1.0", payload: { id, tenantId: s.t } });
    await q.drain(); await q.stop();
    expect(q.dlq.length).toBe(1);
    expect(await ledgerCount(s.t)).toBe(0);
  });
  it("release from restriction: restricted -> unrestricted posts; releasing from an unrestricted fund, or into a restricted one, is refused", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const r = await newFund(s.t, "R1", "restricted"), u = await newFund(s.t, "U1", "unrestricted");
    await seedFundBalance(s, r, 3_000n);
    const rel = (from: string, to: string, n: bigint): L[] => [dr(FUND_HEADS.releaseOut, n, from), cr(FUND_HEADS.dueTo, n, from), dr(FUND_HEADS.dueFrom, n, to), cr(FUND_HEADS.releaseIn, n, to)];
    expect(await draftAndApprove(s.t, "fund_release", rel(r, u, 1_000n))).toBe(0);
    expect(await scoped(s.t, (tx) => fundBalanceTx(tx, s.t, r))).toBe(2_000n);
    await seedFundBalance(s, u, 500n);
    expect(await draftAndApprove(s.t, "fund_release", rel(u, r, 100n))).toBe(1); // source not restricted
    expect(await draftAndApprove(s.t, "fund_release", rel(r, r, 100n))).toBe(1); // not two funds
  });
  it("a transfer across the FCRA boundary is refused", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f = await newFund(s.t, "FC1", "unrestricted", true), n = await newFund(s.t, "N1", "unrestricted", false);
    const lines: L[] = [dr(FUND_HEADS.transferOut, 5n, f), cr(FUND_HEADS.dueTo, 5n, f), dr(FUND_HEADS.dueFrom, 5n, n), cr(FUND_HEADS.transferIn, 5n, n)];
    expect(await draftAndApprove(s.t, "fund_transfer", lines)).toBe(1);
    expect(await ledgerCount(s.t)).toBe(0);
  });
});

describe("restricted spend cannot exceed the fund balance", () => {
  it("a single overspend is refused and a spend of exactly the balance posts", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const r = await newFund(s.t, "R1", "restricted");
    await seedFundBalance(s, r, 1_000n);
    expect(await post(s.t, [dr("5100", 1_001n, r), cr("1100", 1_001n, r)])).toBe(1);
    expect(await post(s.t, [dr("5100", 1_000n, r), cr("1100", 1_000n, r)])).toBe(0);
    expect(await scoped(s.t, (tx) => fundBalanceTx(tx, s.t, r))).toBe(0n);
  });
  it("two concurrent spends of 600 against a balance of 1000: exactly one posts, the fund never goes negative (fund row lock)", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const r = await newFund(s.t, "R1", "restricted");
    await seedFundBalance(s, r, 1_000n);
    const lines = [dr("5100", 600n, r), cr("1100", 600n, r)];
    const dead = await Promise.all([post(s.t, lines), post(s.t, lines)]);
    expect(dead.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await scoped(s.t, (tx) => fundBalanceTx(tx, s.t, r))).toBe(400n);
  });
  it("a corpus fund's balance cannot be spent", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const c = await newFund(s.t, "C1", "corpus");
    await seedFundBalance(s, c, 10_000n);
    expect(await post(s.t, [dr("5100", 1n, c), cr("1100", 1n, c)])).toBe(1);
  });
  it("an unrestricted fund may run a deficit", async () => {
    const s = await seedTenant({ fundAccounting: true });
    expect(await post(s.t, [dr("5100", 40n), cr("1100", 40n)])).toBe(0);
  });
});

describe("fund_accounting flip guards, fund immutability, simplified writer", () => {
  it("the flag cannot flip while a manual draft is pending approval", async () => {
    const s = await seedTenant({ fundAccounting: false });
    await ensureGeneral(s.t);
    const q = tenantWrappedQueue(); registerGlConsumers(q); await q.start();
    const id = randomUUID();
    await q.publish(COMMANDS.journalCreate, { messageId: id, type: COMMANDS.journalCreate, tenantId: s.t, actorId: MAKER, correlationId: "c", schemaVersion: "1.0",
      payload: { id, tenantId: s.t, voucherNo: "AUTO", type: "journal", postingDate: "2026-08-10", lines: [dr("1100", 5n), cr("4100", 5n)], budgetOverride: false } });
    await q.drain(); await q.stop();
    await expect(scoped(s.t, (tx) => tx.execute(sql`UPDATE gl.finance_settings SET fund_accounting = true WHERE tenant_id = ${s.t}::uuid`))).rejects.toThrow(/FUND_ACCOUNTING_FLIP_PENDING_DRAFTS/);
  });
  it("turning OFF is refused once a fund-tagged ledger row exists", async () => {
    const s = await seedTenant({ fundAccounting: true });
    expect(await post(s.t, [dr("1100", 5n), cr("4100", 5n)])).toBe(0);
    await expect(scoped(s.t, (tx) => tx.execute(sql`UPDATE gl.finance_settings SET fund_accounting = false WHERE tenant_id = ${s.t}::uuid`))).rejects.toThrow(/FUND_ACCOUNTING_IRREVERSIBLE/);
  });
  it("turning OFF before any tagged row exists is allowed (and a no-change update is not blocked)", async () => {
    const s = await seedTenant({ fundAccounting: true });
    await scoped(s.t, (tx) => tx.execute(sql`UPDATE gl.finance_settings SET fund_accounting = true WHERE tenant_id = ${s.t}::uuid`));
    await scoped(s.t, (tx) => tx.execute(sql`UPDATE gl.finance_settings SET fund_accounting = false WHERE tenant_id = ${s.t}::uuid`));
  });
  it("fund code / type / fcra are immutable after the first posting to the fund, and editable before", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f = await newFund(s.t, "F1", "restricted");
    await scoped(s.t, (tx) => tx.execute(sql`UPDATE gl.funds SET fcra = true WHERE id = ${f}::uuid`));
    await seedFundBalance(s, f, 10n);
    await expect(scoped(s.t, (tx) => tx.execute(sql`UPDATE gl.funds SET fcra = false WHERE id = ${f}::uuid`))).rejects.toThrow(/FUND_LOCKED/);
    await expect(scoped(s.t, (tx) => tx.execute(sql`UPDATE gl.funds SET type = 'corpus' WHERE id = ${f}::uuid`))).rejects.toThrow(/FUND_LOCKED/);
    await scoped(s.t, (tx) => tx.execute(sql`UPDATE gl.funds SET name = 'Renamed' WHERE id = ${f}::uuid`)); // name is not locked
  });
  it("the simplified (MSME) writer is refused while fund accounting is on and is a no-op while it is off", async () => {
    const on = await seedTenant({ fundAccounting: true });
    const off = await seedTenant({ fundAccounting: false });
    await expect(scoped(on.t, (tx) => assertFundAccountingOffTx(tx, on.t, "the simplified (MSME) ledger"))).rejects.toThrow(/FUND_UNSUPPORTED_WRITER/);
    await scoped(off.t, (tx) => assertFundAccountingOffTx(tx, off.t, "the simplified (MSME) ledger"));
  });
  it("fundContext resolves the GENERAL fund for an ON tenant and refuses an ON tenant without one", async () => {
    const ok = await seedTenant({ fundAccounting: true });
    expect((await scoped(ok.t, (tx) => fundContext(tx, ok.t))).generalFundId).toBe(ok.general);
    const bad = await seedTenant({ fundAccounting: true, general: false });
    await expect(scoped(bad.t, (tx) => fundContext(tx, bad.t))).rejects.toThrow(/FUND_ACCOUNTING_NOT_READY/);
  });
});
async function ensureGeneral(t: string) { await scoped(t, (tx) => ensureGeneralFundTx(tx, t, MAKER)); }

describe("per-fund year-end rollover", () => {
  it("rolls each fund forward on its own (history with NULL fund_id lands in GENERAL), every fund nets to zero, and a re-run is a no-op", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const r = await newFund(s.t, "R1", "restricted");
    // GENERAL history written BEFORE funds existed: fund_id NULL (resolves to GENERAL at read)
    const nullRow = (code: string, d: bigint, c: bigint) => ({
      tenantId: s.t, headId: (s.heads.get(code) as { id: string }).id, voucherNo: "HIST", postingDate: "2026-05-02",
      debitMinor: d, creditMinor: c, balanceMinor: d - c, createdBy: MAKER, updatedBy: MAKER,
    });
    await scoped(s.t, (tx) => tx.insert(financeLedger).values([nullRow("1100", 800n, 0n), nullRow("4100", 0n, 800n)]));
    await seedFundBalance(s, r, 300n); // R: cash 300 / income 300
    const run = () => scoped(s.t, (tx) => fundYearEndRollover(tx, { tenantId: s.t, actorId: MAKER }, { fy: "2026-27", next: "2027-28", reason: "nf1 test" }));
    const first = await run();
    expect(first.changed).toBe(true);
    const rows = await q1(s.t, sql`SELECT fund_id::text AS f, account_code AS code, (debit_minor - credit_minor)::text AS net FROM gl.finance_opening_balances
      WHERE tenant_id = ${s.t}::uuid AND fy_code = '2027-28' AND source = 'fy_close' ORDER BY fund_id, account_code`);
    const byFund = new Map<string, bigint>();
    for (const x of rows) byFund.set(String(x.f), (byFund.get(String(x.f)) ?? 0n) + BigInt(String(x.net)));
    expect([...byFund.keys()].sort()).toEqual([s.general as string, r].sort());
    for (const [f, v] of byFund) expect(v, f).toBe(0n);
    const gen = rows.filter((x) => x.f === s.general);
    expect(gen).toEqual(expect.arrayContaining([{ f: s.general, code: "1100", net: "800" }, { f: s.general, code: "3100", net: "-800" }]));
    const second = await run();
    expect(second.changed).toBe(false);
  });
});

describe("cash book and opening balances carry the fund", () => {
  const cashEntry = (t: string, headId?: string) => ({
    tenantId: t, entryDate: "2026-08-10", voucherType: "receipt" as const, voucherNo: `CB-${randomUUID().slice(0, 6)}`, particulars: "x",
    receiptMinor: 10n, paymentMinor: 0n, bankOrCash: "bank" as const, reference: `ref:${randomUUID()}`, actorId: MAKER, ...(headId ? { headId } : {}),
  });
  it("OFF: fund_id and the head tag stay NULL even if a head is passed; ON: GENERAL + the head tag; ON without GENERAL is refused", async () => {
    const off = await seedTenant({ fundAccounting: false });
    const on = await seedTenant({ fundAccounting: true });
    const bad = await seedTenant({ fundAccounting: true, general: false });
    const bankOff = (off.heads.get("1100") as { id: string }).id, bankOn = (on.heads.get("1100") as { id: string }).id;
    await scoped(off.t, (tx) => postCashBook(tx as never, cashEntry(off.t, bankOff)));
    await scoped(on.t, (tx) => postCashBook(tx as never, cashEntry(on.t, bankOn)));
    expect(await q1(off.t, sql`SELECT fund_id, head_id FROM gl.finance_cash_book WHERE tenant_id = ${off.t}::uuid`)).toEqual([{ fund_id: null, head_id: null }]);
    expect(await q1(on.t, sql`SELECT fund_id::text AS f, head_id::text AS h FROM gl.finance_cash_book WHERE tenant_id = ${on.t}::uuid`)).toEqual([{ f: on.general, h: bankOn }]);
    await expect(scoped(bad.t, (tx) => postCashBook(tx as never, cashEntry(bad.t)))).rejects.toThrow(/FUND_ACCOUNTING_NOT_READY/);
  });
  it("opening balances: the same account may be opened in two funds; the same (account, fund) twice, and a NULL row twice, are refused", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f = await newFund(s.t, "F1", "restricted");
    const ins = (fund: string | null) => scoped(s.t, (tx) => tx.execute(sql`INSERT INTO gl.finance_opening_balances (tenant_id, fy_code, account_code, debit_minor, credit_minor, entered_by, fund_id)
      VALUES (${s.t}::uuid, '2027-28', '1100', 5, 0, ${MAKER}::uuid, ${fund}::uuid)`));
    await ins(f);
    await ins(s.general);
    await expect(ins(f)).rejects.toThrow(/uq_opening_balances|duplicate key/);
    const off = await seedTenant({ fundAccounting: false });
    const insOff = () => scoped(off.t, (tx) => tx.execute(sql`INSERT INTO gl.finance_opening_balances (tenant_id, fy_code, account_code, debit_minor, credit_minor, entered_by)
      VALUES (${off.t}::uuid, '2027-28', '1100', 5, 0, ${MAKER}::uuid)`));
    await insOff();
    await expect(insOff()).rejects.toThrow(/uq_opening_balances|duplicate key/);
    expect(await q1(off.t, sql`SELECT fund_id FROM gl.finance_opening_balances WHERE tenant_id = ${off.t}::uuid`)).toEqual([{ fund_id: null }]);
  });
});

describe("the funds API is invisible to a tenant without fund accounting", () => {
  it("GET /v1/finance/funds is 404 FUNDS_NOT_ENABLED while OFF and lists GENERAL once ON; POST transfers is 404 while OFF", async () => {
    const app = await buildApp();
    try {
      const off = await seedTenant({ fundAccounting: false });
      const on = await seedTenant({ fundAccounting: true });
      const get = (t: string, url: string) => app.inject({ method: "GET", url, headers: bearer(t, MAKER, ["finance_officer"]) });
      const r1 = await get(off.t, "/v1/finance/funds");
      expect(r1.statusCode).toBe(404);
      expect(r1.body).toContain("FUNDS_NOT_ENABLED");
      const r2 = await get(on.t, "/v1/finance/funds");
      expect(r2.statusCode).toBe(200);
      expect((r2.json() as { data: Array<{ code: string }> }).data.map((f) => f.code)).toEqual(["GENERAL"]);
      const r3 = await app.inject({ method: "POST", url: "/v1/finance/funds/transfers", headers: bearer(off.t, MAKER, ["finance_officer"]),
        payload: { fromFundId: randomUUID(), toFundId: randomUUID(), amountMinor: "100", postingDate: "2026-08-10" } });
      expect(r3.statusCode).toBe(404);
    } finally { await app.close(); }
  });
});
