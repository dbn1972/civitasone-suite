/**
 * Section 8 NF-3, REAL Postgres (the orchestrator's test-runner runs this on a throwaway database; the author does not).
 * Needs migrations 0170 + 0171 + 0172 applied.
 *
 *  1. migration shape: capital_grant_policy column/CHECK, the three tables with ENABLE + FORCE RLS + policy, composite FKs,
 *     triggers; grant_postings is append-only.
 *  2. deferred-income lifecycle: receipt / capitalise / release journals post through finance.gl.post and balance PER FUND.
 *  3. revenue grants: receipt -> recognition (salary / general); utilisation + unspent tracking; headroom refusals.
 *  4. capital_fund policy: receipt credits 3300, capitalise / release refused, 2340 / 2350 / 4450 idle; policy locks after a capital posting.
 *  5. RLS / cross-tenant isolation.
 *  6. govt + flag-off: a strict no-op -- no gl.grants rows, no grant journals, no new heads, ledger untouched, routes 404.
 *  7. idempotent replay; grant identity immutable once posted.
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
import { ensureGeneralFundTx, fundBalanceTx } from "../src/modules/gl/funds.js";
import { loadPostingSettingsTx } from "../src/modules/approvals/posting-settings.js";
import { GRANT_HEAD_CODES } from "../src/modules/gl/system-heads.js";
import {
  createGrantTx, getGrantTx, listGrantsTx, recordGrantReceiptTx, recogniseRevenueGrantTx, capitaliseGrantTx, releaseCapitalGrantTx,
  setCapitalGrantPolicyTx, recordUtilisationMetaTx, type CreateGrantInput,
} from "../src/modules/grants/service.js";
import { buildApp } from "../src/app.js";
import { bearer } from "./_fp02.js";

const MAKER = "00000000-0f31-4000-8000-0000000000a1";
const H = GRANT_HEAD_CODES();
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? r : (r as { rows: Record<string, unknown>[] }).rows);
const q1 = async (t: string, query: ReturnType<typeof sql>) => rowsOf(await scoped(t, (tx) => tx.execute(query)));
const meta = (t: string) => ({ tenantId: t, actorId: MAKER, correlationId: "corr-nf3" });
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
async function seedTenant(opts: { fundAccounting: boolean; skipHeads?: boolean }) {
  const t = randomUUID(); tenants.push(t);
  if (!opts.skipHeads) await scoped(t, (tx) => tx.insert(financeHeads).values(HEAD_DEFS.map(([code, classification]) => ({
    id: randomUUID(), tenantId: t, code, name: `Head ${code}`, level: 0, classification, createdBy: MAKER, updatedBy: MAKER,
  }))));
  await scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.finance_settings (tenant_id, budget_control, updated_by) VALUES (${t}::uuid, 'off', ${MAKER}::uuid)`));
  let general: string | null = null;
  if (opts.fundAccounting) {
    general = await scoped(t, (tx) => ensureGeneralFundTx(tx, t, MAKER));
    await scoped(t, (tx) => tx.execute(sql`UPDATE gl.finance_settings SET fund_accounting = true WHERE tenant_id = ${t}::uuid`));
  }
  return { t, general };
}
async function newFund(t: string, code: string, type: "corpus" | "restricted" | "unrestricted" | "designated" = "restricted"): Promise<string> {
  const id = randomUUID();
  await scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.funds (id, tenant_id, code, name, type, fcra, created_by, updated_by)
    VALUES (${id}::uuid, ${t}::uuid, ${code}, ${code}, ${type}, false, ${MAKER}::uuid, ${MAKER}::uuid)`));
  return id;
}
const grantInput = (fundId: string, category: CreateGrantInput["category"], amountSanctionedMinor = 10_000_000n, ref = `SAN/${randomUUID().slice(0, 8)}`): CreateGrantInput => ({
  fundId, category, grantor: "Dept of Higher Education", schemeCode: "SCH-1", sanctionRef: ref, sanctionDate: "2026-04-01", amountSanctionedMinor,
});
const ev = (grantId: string, amountMinor: bigint, id?: string) => ({ grantId, amountMinor, postingDate: "2026-08-10", ...(id ? { id } : {}) });

/** Publish every finance.gl.post message the grant ops enqueued for this tenant through the real GL consumer; returns the DLQ size. */
async function drainGrantJournals(t: string): Promise<number> {
  const msgs = rowsOf(await scoped(t, (tx) => tx.execute(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${t}::uuid AND topic = ${COMMANDS.journalPost} ORDER BY created_at, id`)));
  const q = new MemoryQueue({ maxAttempts: 1 });
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    raw(topic, async (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  registerGlConsumers(q);
  await q.start();
  for (const m of msgs) {
    await q.publish(COMMANDS.journalPost, {
      messageId: randomUUID(), type: COMMANDS.journalPost, tenantId: t, actorId: MAKER, correlationId: "corr-nf3", schemaVersion: "1.0",
      payload: m.payload as Record<string, unknown>,
    });
  }
  await q.drain();
  await q.stop();
  return q.dlq.length;
}
const headNet = async (t: string, code: string, fund?: string) => {
  const r = await q1(t, sql`SELECT COALESCE(SUM(fl.debit_minor - fl.credit_minor), 0)::text AS n FROM gl.finance_ledger fl
    JOIN budget.finance_heads fh ON fh.id = fl.head_id AND fh.tenant_id = fl.tenant_id
    WHERE fl.tenant_id = ${t}::uuid AND fh.code = ${code} ${fund ? sql`AND fl.fund_id = ${fund}::uuid` : sql``}`);
  return BigInt(String(r[0]?.n));
};
const perFundNet = (t: string) => q1(t, sql`SELECT fund_id::text AS fund_id, SUM(debit_minor - credit_minor)::text AS net FROM gl.finance_ledger WHERE tenant_id = ${t}::uuid GROUP BY fund_id`);
const count = async (t: string, table: string) => Number((await q1(t, sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE tenant_id = ${t}::uuid`))[0]?.n);

describe("migration 0172: shape", () => {
  it("gl.finance_settings.capital_grant_policy: text NOT NULL DEFAULT 'deferred_income' with the two-value CHECK", async () => {
    const c = rowsOf(await sqlClient`SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'gl' AND table_name = 'finance_settings' AND column_name = 'capital_grant_policy'`);
    expect(c[0]).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(String(c[0]?.column_default)).toMatch(/deferred_income/);
    const chk = rowsOf(await sqlClient`SELECT pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conname = 'finance_settings_capital_grant_policy_check'`);
    expect(chk[0]?.convalidated).toBe(true);
    expect(String(chk[0]?.def)).toMatch(/deferred_income.*capital_fund/);
    const s = await seedTenant({ fundAccounting: false });
    await expect(scoped(s.t, (tx) => tx.execute(sql`UPDATE gl.finance_settings SET capital_grant_policy = 'bogus' WHERE tenant_id = ${s.t}::uuid`))).rejects.toThrow();
  });
  it("the three tables have ENABLE + FORCE RLS and a tenant policy; gl.grants has the composite tenant-scoped fund FK and the category CHECK", async () => {
    for (const tbl of ["grants", "grant_postings", "grant_utilisation"]) {
      const rls = rowsOf(await sqlClient`SELECT relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'gl' AND c.relname = ${tbl}`);
      expect(rls[0], tbl).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
      const pol = rowsOf(await sqlClient`SELECT polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'gl' AND c.relname = ${tbl}`);
      expect(pol.length, tbl).toBeGreaterThan(0);
    }
    const fk = rowsOf(await sqlClient`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'grants_fund_fk'`);
    expect(String(fk[0]?.def)).toMatch(/FOREIGN KEY \(tenant_id, fund_id\) REFERENCES gl\.funds\(tenant_id, id\)/);
    const cats = rowsOf(await sqlClient`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'grants_category_check'`);
    expect(String(cats[0]?.def)).toMatch(/salary.*general.*capital/);
  });
  it("UC form and interest treatment are nullable; the triggers exist", async () => {
    const cols = rowsOf(await sqlClient`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'gl' AND table_name = 'grant_utilisation'`);
    const nullable = Object.fromEntries(cols.map((c) => [String(c.column_name), c.is_nullable]));
    expect(nullable).toMatchObject({ uc_form: "YES", uc_submitted_date: "YES", interest_treatment: "YES", interest_earned_minor: "NO" });
    const trg = rowsOf(await sqlClient`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`).map((r) => r.tgname);
    for (const g of ["trg_grant_postings_no_mutate", "trg_grant_immutable", "trg_capital_grant_policy"]) expect(trg).toContain(g);
  });
});

describe("deferred-income policy (default): capital grant lifecycle", () => {
  it("receipt -> capitalise -> release post through the GL consumer; every journal balances per fund; heads land as specified", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f = await newFund(s.t, "CAPGRANT");
    expect((await scoped(s.t, (tx) => loadPostingSettingsTx(tx, s.t))).capitalGrantPolicy).toBe("deferred_income");
    const g = await scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "capital", 1_000_000n)));
    await scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), ev(g.id, 600_000n)));
    await scoped(s.t, (tx) => capitaliseGrantTx(tx, meta(s.t), ev(g.id, 600_000n)));
    await scoped(s.t, (tx) => releaseCapitalGrantTx(tx, meta(s.t), ev(g.id, 100_000n)));
    expect(await drainGrantJournals(s.t)).toBe(0);
    expect(await headNet(s.t, "1100", f)).toBe(600_000n);
    expect(await headNet(s.t, H.capitalReceipt, f)).toBe(0n);          // received then reclassified: nothing left unutilised
    expect(await headNet(s.t, H.capitalDeferred, f)).toBe(-500_000n);  // 600k deferred less 100k released (credit-normal)
    expect(await headNet(s.t, H.capitalRelease, f)).toBe(-100_000n);
    expect(await headNet(s.t, H.capitalFund)).toBe(0n);                // the capital-fund head stays idle
    // every ledger row of the grant is tagged to the grant's fund, and the fund nets to zero (it is a closed double entry per fund)
    const nets = await perFundNet(s.t);
    expect(nets).toEqual([{ fund_id: f, net: "0" }]);
    const lines = await q1(s.t, sql`SELECT DISTINCT fund_id::text AS fund_id FROM gl.finance_journal_lines WHERE tenant_id = ${s.t}::uuid`);
    expect(lines).toEqual([{ fund_id: f }]);
    const got = await scoped(s.t, (tx) => getGrantTx(tx, s.t, g.id));
    expect(got.totals).toMatchObject({ receipt: 600_000n, capitalisation: 600_000n, release: 100_000n });
    expect(got.grant.status).toBe("active");
  });
  it("headroom: cannot capitalise more than received, release more than capitalised, or receive more than sanctioned; refusals write nothing", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f = await newFund(s.t, "CAP2");
    const g = await scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "capital", 1_000n)));
    await scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), ev(g.id, 800n)));
    expect(await codeOf(scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), ev(g.id, 201n))))).toBe("GRANT_OVER_SANCTION");
    expect(await codeOf(scoped(s.t, (tx) => capitaliseGrantTx(tx, meta(s.t), ev(g.id, 801n))))).toBe("GRANT_CAPITALISATION_EXCEEDS_RECEIPTS");
    expect(await codeOf(scoped(s.t, (tx) => releaseCapitalGrantTx(tx, meta(s.t), ev(g.id, 1n))))).toBe("GRANT_RELEASE_EXCEEDS_CAPITALISED");
    expect(await codeOf(scoped(s.t, (tx) => recogniseRevenueGrantTx(tx, meta(s.t), ev(g.id, 1n))))).toBe("GRANT_CATEGORY");
    expect(await count(s.t, "gl.grant_postings")).toBe(1);
  });
});

describe("revenue grants: receipt then recognition", () => {
  it("salary and general grants route to 2320/4430 and 2330/4440; utilisation + unspent balance are tracked; UC form stays NULL until set", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f = await newFund(s.t, "REVGRANT");
    const sal = await scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "salary", 2_000_000n)));
    const gen = await scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "general", 1_000_000n)));
    await scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), ev(sal.id, 1_500_000n)));
    await scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), ev(gen.id, 400_000n)));
    await scoped(s.t, (tx) => recogniseRevenueGrantTx(tx, meta(s.t), ev(sal.id, 900_000n)));
    await scoped(s.t, (tx) => recogniseRevenueGrantTx(tx, meta(s.t), ev(gen.id, 100_000n)));
    expect(await drainGrantJournals(s.t)).toBe(0);
    expect(await headNet(s.t, H.revenueReceiptSalary, f)).toBe(-600_000n);
    expect(await headNet(s.t, H.revenueIncomeSalary, f)).toBe(-900_000n);
    expect(await headNet(s.t, H.revenueReceiptGeneral, f)).toBe(-300_000n);
    expect(await headNet(s.t, H.revenueIncomeGeneral, f)).toBe(-100_000n);
    expect(await perFundNet(s.t)).toEqual([{ fund_id: f, net: "0" }]);
    const u = await q1(s.t, sql`SELECT amount_utilised_minor::text AS used, unspent_balance_minor::text AS unspent, uc_form, uc_submitted_date FROM gl.grant_utilisation WHERE tenant_id = ${s.t}::uuid AND grant_id = ${sal.id}::uuid`);
    expect(u).toEqual([{ used: "900000", unspent: "600000", uc_form: null, uc_submitted_date: null }]);
    // the fund's computed balance reflects the income recognised (credit-normal income heads)
    expect(await scoped(s.t, (tx) => fundBalanceTx(tx, s.t, f))).toBe(1_000_000n);
    const upd = await scoped(s.t, (tx) => recordUtilisationMetaTx(tx, meta(s.t), { grantId: sal.id, period: "2026-08", interestEarnedMinor: 1_200n, interestTreatment: "remit", ucForm: "UC-FORM-X", ucSubmittedDate: "2026-09-15" }));
    expect(upd).toMatchObject({ ucForm: "UC-FORM-X", interestTreatment: "remit", interestEarnedMinor: 1_200n });
    const rl = await scoped(s.t, (tx) => listGrantsTx(tx, s.t));
    expect(rl.length).toBe(2);
  });
  it("utilisation cannot exceed receipts, and nothing is written by the refusal", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f = await newFund(s.t, "REV2");
    const g = await scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "general", 1_000n)));
    await scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), ev(g.id, 300n)));
    expect(await codeOf(scoped(s.t, (tx) => recogniseRevenueGrantTx(tx, meta(s.t), ev(g.id, 301n))))).toBe("GRANT_UTILISATION_EXCEEDS_RECEIPTS");
    expect(await count(s.t, "gl.grant_postings")).toBe(1);
    expect(await count(s.t, "gl.grant_utilisation")).toBe(0);
  });
  it("a closed fund cannot take a grant event; a missing chart head is refused (GRANT_HEADS_MISSING)", async () => {
    const s = await seedTenant({ fundAccounting: true, skipHeads: true });   // a chart that was never seeded
    const f = await newFund(s.t, "REV3");
    const g = await scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "salary", 1_000n)));
    expect(await codeOf(scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), ev(g.id, 10n))))).toBe("GRANT_HEADS_MISSING");
    const s2 = await seedTenant({ fundAccounting: true });
    const f2 = await newFund(s2.t, "CLOSEME");
    const g2 = await scoped(s2.t, (tx) => createGrantTx(tx, meta(s2.t), grantInput(f2, "salary", 1_000n)));
    await scoped(s2.t, (tx) => tx.execute(sql`UPDATE gl.funds SET status = 'closed' WHERE id = ${f2}::uuid`));
    expect(await codeOf(scoped(s2.t, (tx) => recordGrantReceiptTx(tx, meta(s2.t), ev(g2.id, 10n))))).toBe("FUND_CLOSED");
  });
});

describe("capital_fund policy (flipped per tenant)", () => {
  it("receipt credits 3300 directly; capitalise / release are refused; 2340 / 2350 / 4450 carry nothing", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f = await newFund(s.t, "CAPFUND");
    await scoped(s.t, (tx) => setCapitalGrantPolicyTx(tx, meta(s.t), "capital_fund", "AS-12 capital approach"));
    expect((await scoped(s.t, (tx) => loadPostingSettingsTx(tx, s.t))).capitalGrantPolicy).toBe("capital_fund");
    const g = await scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "capital", 1_000_000n)));
    await scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), ev(g.id, 400_000n)));
    expect(await codeOf(scoped(s.t, (tx) => capitaliseGrantTx(tx, meta(s.t), ev(g.id, 1n))))).toBe("GRANT_POLICY_NOT_APPLICABLE");
    expect(await codeOf(scoped(s.t, (tx) => releaseCapitalGrantTx(tx, meta(s.t), ev(g.id, 1n))))).toBe("GRANT_POLICY_NOT_APPLICABLE");
    expect(await drainGrantJournals(s.t)).toBe(0);
    expect(await headNet(s.t, H.capitalFund, f)).toBe(-400_000n);
    for (const idle of [H.capitalReceipt, H.capitalDeferred, H.capitalRelease]) expect(await headNet(s.t, idle), idle).toBe(0n);
    expect(await perFundNet(s.t)).toEqual([{ fund_id: f, net: "0" }]);
  });
  it("the policy flips freely before any capital grant posts, and is LOCKED once one has (GRANT_POLICY_LOCKED); a revenue grant does not lock it", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f = await newFund(s.t, "LOCKP");
    await scoped(s.t, (tx) => setCapitalGrantPolicyTx(tx, meta(s.t), "capital_fund", "r1"));
    await scoped(s.t, (tx) => setCapitalGrantPolicyTx(tx, meta(s.t), "deferred_income", "r2"));
    const rev = await scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "general", 1_000n)));
    await scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), ev(rev.id, 10n)));
    await scoped(s.t, (tx) => setCapitalGrantPolicyTx(tx, meta(s.t), "capital_fund", "r3"));
    const cap = await scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "capital", 1_000n)));
    await scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), ev(cap.id, 10n)));
    expect(await codeOf(scoped(s.t, (tx) => setCapitalGrantPolicyTx(tx, meta(s.t), "deferred_income", "r4")))).toBe("GRANT_POLICY_LOCKED");
  });
});

describe("cross-tenant isolation (RLS + composite FK)", () => {
  it("tenant B cannot read A's grants, cannot write a grant for A, and cannot register a grant against A's fund", async () => {
    const a = await seedTenant({ fundAccounting: true });
    const b = await seedTenant({ fundAccounting: true });
    const fa = await newFund(a.t, "A-FUND");
    const ga = await scoped(a.t, (tx) => createGrantTx(tx, meta(a.t), grantInput(fa, "general", 1_000n)));
    expect((await q1(b.t, sql`SELECT id FROM gl.grants WHERE id = ${ga.id}::uuid`)).length).toBe(0);
    expect((await q1(a.t, sql`SELECT id FROM gl.grants WHERE id = ${ga.id}::uuid`)).length).toBe(1);
    expect(await codeOf(scoped(b.t, (tx) => createGrantTx(tx, meta(b.t), grantInput(fa, "general", 1_000n))))).toBe("FUND_NOT_FOUND");
    await expect(scoped(b.t, (tx) => tx.execute(sql`INSERT INTO gl.grants (tenant_id, fund_id, category, grantor, sanction_ref, sanction_date, amount_sanctioned_minor, created_by, updated_by)
      VALUES (${a.t}::uuid, ${fa}::uuid, 'general', 'G', 'X', '2026-04-01', 5, ${MAKER}::uuid, ${MAKER}::uuid)`))).rejects.toThrow();
    // a raw insert that bypasses the service still cannot point at another tenant's fund (composite FK)
    await expect(scoped(b.t, (tx) => tx.execute(sql`INSERT INTO gl.grants (tenant_id, fund_id, category, grantor, sanction_ref, sanction_date, amount_sanctioned_minor, created_by, updated_by)
      VALUES (${b.t}::uuid, ${fa}::uuid, 'general', 'G', 'Y', '2026-04-01', 5, ${MAKER}::uuid, ${MAKER}::uuid)`))).rejects.toThrow(/foreign key|violates/i);
    expect(await codeOf(scoped(b.t, (tx) => getGrantTx(tx, b.t, ga.id)))).toBe("GRANT_NOT_FOUND");
  });
});

describe("govt / fund_accounting OFF: a strict no-op", () => {
  it("every grants op refuses GRANTS_NOT_ENABLED; no gl.grants / posting / utilisation row, no grant journal, no new head, ledger untouched", async () => {
    const off = await seedTenant({ fundAccounting: false });
    const heads0 = await count(off.t, "budget.finance_heads");
    const f = await newFund(off.t, "OFFFUND");
    expect(await codeOf(scoped(off.t, (tx) => createGrantTx(tx, meta(off.t), grantInput(f, "general")))) ).toBe("GRANTS_NOT_ENABLED");
    const fake = randomUUID();
    for (const op of [recordGrantReceiptTx, recogniseRevenueGrantTx, capitaliseGrantTx, releaseCapitalGrantTx]) {
      expect(await codeOf(scoped(off.t, (tx) => op(tx, meta(off.t), ev(fake, 1n))))).toBe("GRANTS_NOT_ENABLED");
    }
    expect(await codeOf(scoped(off.t, (tx) => setCapitalGrantPolicyTx(tx, meta(off.t), "capital_fund", "x")))).toBe("GRANTS_NOT_ENABLED");
    expect(await codeOf(scoped(off.t, (tx) => listGrantsTx(tx, off.t)))).toBe("GRANTS_NOT_ENABLED");
    for (const tbl of ["gl.grants", "gl.grant_postings", "gl.grant_utilisation", "gl.finance_ledger", "gl.finance_journals", "gl.finance_journal_lines"]) {
      expect(await count(off.t, tbl), tbl).toBe(0);
    }
    expect(await count(off.t, "budget.finance_heads")).toBe(heads0);
    expect(rowsOf(await scoped(off.t, (tx) => tx.execute(sql`SELECT 1 FROM _outbox.messages WHERE tenant_id = ${off.t}::uuid AND topic = ${COMMANDS.journalPost}`))).length).toBe(0);
    // the capital-grant policy column is inert: a govt row keeps the default and the posting settings still read it as deferred_income
    const ps = await scoped(off.t, (tx) => loadPostingSettingsTx(tx, off.t));
    expect(ps).toMatchObject({ fundAccounting: false, capitalGrantPolicy: "deferred_income" });
  });
  it("the HTTP routes answer 404 GRANTS_NOT_ENABLED for a flag-off tenant and work for a flag-on tenant", async () => {
    const off = await seedTenant({ fundAccounting: false });
    const on = await seedTenant({ fundAccounting: true });
    const app = await buildApp();
    try {
      const r1 = await app.inject({ method: "GET", url: "/v1/finance/grants", headers: bearer(off.t, MAKER, ["finance_officer"]) });
      expect(r1.statusCode).toBe(404);
      expect(r1.body).toContain("GRANTS_NOT_ENABLED");
      const r2 = await app.inject({ method: "GET", url: "/v1/finance/grants", headers: bearer(on.t, MAKER, ["finance_officer"]) });
      expect(r2.statusCode).toBe(200);
      const f = await newFund(on.t, "HTTPF");
      const r3 = await app.inject({ method: "POST", url: "/v1/finance/grants", headers: bearer(on.t, MAKER, ["finance_admin"]),
        payload: { fundId: f, category: "general", grantor: "State", sanctionRef: "HTTP/1", sanctionDate: "2026-04-01", amountSanctionedMinor: "5000" } });
      expect(r3.statusCode).toBe(201);
      const r4 = await app.inject({ method: "POST", url: "/v1/finance/grants", headers: bearer(on.t, MAKER, ["finance_officer"]),
        payload: { fundId: f, category: "general", grantor: "State", sanctionRef: "HTTP/2", sanctionDate: "2026-04-01", amountSanctionedMinor: "5000" } });
      expect([401, 403]).toContain(r4.statusCode);
    } finally { await app.close(); }
  });
});

describe("idempotency and immutability", () => {
  it("a repeated posting id returns the first result: one posting row, one journal; reusing the id for another event is refused", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f = await newFund(s.t, "IDEM");
    const g = await scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "general", 1_000n)));
    const id = randomUUID();
    const a = await scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), ev(g.id, 100n, id)));
    const b = await scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), ev(g.id, 100n, id)));
    expect(b).toMatchObject({ postingId: a.postingId, journalId: a.journalId, replayed: true });
    expect(await count(s.t, "gl.grant_postings")).toBe(1);
    expect(await codeOf(scoped(s.t, (tx) => recogniseRevenueGrantTx(tx, meta(s.t), ev(g.id, 10n, id))))).toBe("GRANT_POSTING_ID_REUSED");
    expect(await drainGrantJournals(s.t)).toBe(0);
    expect(await count(s.t, "gl.finance_journals")).toBe(1);
  });
  it("grant_postings is append-only; a posted grant's fund / category / sanctioned amount cannot change; a duplicate sanction is refused", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f = await newFund(s.t, "IMM1"); const f2 = await newFund(s.t, "IMM2");
    const g = await scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "general", 1_000n, "SAN/DUP")));
    expect(await codeOf(scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "general", 1_000n, "SAN/DUP"))))).toBe("GRANT_EXISTS");
    await scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), ev(g.id, 10n)));
    await expect(scoped(s.t, (tx) => tx.execute(sql`UPDATE gl.grant_postings SET amount_minor = 1 WHERE tenant_id = ${s.t}::uuid`))).rejects.toThrow(/GRANT_POSTING_IMMUTABLE|permission denied/);
    await expect(scoped(s.t, (tx) => tx.execute(sql`DELETE FROM gl.grant_postings WHERE tenant_id = ${s.t}::uuid`))).rejects.toThrow();
    await expect(scoped(s.t, (tx) => tx.execute(sql`UPDATE gl.grants SET fund_id = ${f2}::uuid WHERE id = ${g.id}::uuid`))).rejects.toThrow(/GRANT_LOCKED/);
    await expect(scoped(s.t, (tx) => tx.execute(sql`UPDATE gl.grants SET amount_sanctioned_minor = 9 WHERE id = ${g.id}::uuid`))).rejects.toThrow(/GRANT_LOCKED/);
    await scoped(s.t, (tx) => tx.execute(sql`UPDATE gl.grants SET status = 'closed' WHERE id = ${g.id}::uuid`));
    expect(await codeOf(scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), ev(g.id, 1n))))).toBe("GRANT_CLOSED");
  });
});

describe("B1: accept-time refusals and replay recoverability", () => {
  const closePeriod = (t: string, period: string, status: string) => scoped(t, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_period_close (tenant_id, fiscal_year, period, status, created_by)
    VALUES (${t}::uuid, '2026-27', ${period}, ${status}, ${MAKER}::uuid)
    ON CONFLICT (tenant_id, fiscal_year, period) DO UPDATE SET status = EXCLUDED.status`));
  const setFy = (t: string, code: string, status: string) => scoped(t, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_fiscal_years (id, tenant_id, code, label, start_date, end_date, status, created_by)
    VALUES (${randomUUID()}::uuid, ${t}::uuid, ${code}, ${code}, '2026-04-01', '2027-03-31', ${status}, ${MAKER}::uuid)`));
  it("a receipt dated in a HARD-closed period is refused 422 PERIOD_CLOSED at accept and writes nothing (no posting, no utilisation, status not flipped, nothing enqueued)", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f = await newFund(s.t, "CLOSEDP");
    const g = await scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "salary", 1_000n)));
    await closePeriod(s.t, "2026-07", "hard_close");
    for (const op of [recordGrantReceiptTx, recogniseRevenueGrantTx]) {
      expect(await codeOf(scoped(s.t, (tx) => op(tx, meta(s.t), { grantId: g.id, amountMinor: 10n, postingDate: "2026-07-10" })))).toBe("PERIOD_CLOSED");
    }
    expect(await count(s.t, "gl.grant_postings")).toBe(0);
    expect(await count(s.t, "gl.grant_utilisation")).toBe(0);
    expect((await scoped(s.t, (tx) => getGrantTx(tx, s.t, g.id))).grant.status).toBe("sanctioned");
    expect(rowsOf(await scoped(s.t, (tx) => tx.execute(sql`SELECT 1 FROM _outbox.messages WHERE tenant_id = ${s.t}::uuid AND topic = ${COMMANDS.journalPost}`))).length).toBe(0);
  });
  it("HTTP: the same refusal is a 422", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f = await newFund(s.t, "CLOSEDH");
    const g = await scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "salary", 1_000n)));
    await closePeriod(s.t, "2026-07", "hard_close");
    const app = await buildApp();
    try {
      const r = await app.inject({ method: "POST", url: `/v1/finance/grants/${g.id}/receipts`, headers: bearer(s.t, MAKER, ["finance_officer"]),
        payload: { amountMinor: "10", postingDate: "2026-07-10" } });
      expect(r.statusCode).toBe(422);
      expect(r.body).toContain("PERIOD_CLOSED");
    } finally { await app.close(); }
  });
  it("a period that closes AFTER accept makes the consumer refuse the journal; a replay is refused while closed, and posts exactly once after the period reopens", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f = await newFund(s.t, "REPLAY");
    const g = await scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "salary", 1_000n)));
    const id = randomUUID();
    const input = { grantId: g.id, amountMinor: 100n, postingDate: "2026-07-10", id };
    const first = await scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), input));
    expect(first.replayed).toBe(false);
    await closePeriod(s.t, "2026-07", "hard_close");       // closes between accept and post
    await drainGrantJournals(s.t);
    expect(await count(s.t, "gl.finance_journals")).toBe(0);  // refused by the consumer; the register row stays (append-only)
    expect(await count(s.t, "gl.grant_postings")).toBe(1);
    expect(await codeOf(scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), input)))).toBe("PERIOD_CLOSED");
    await closePeriod(s.t, "2026-07", "open");
    const again = await scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), input));
    expect(again).toMatchObject({ postingId: first.postingId, journalId: first.journalId, replayed: true });
    await drainGrantJournals(s.t);
    expect(await count(s.t, "gl.finance_journals")).toBe(1);
    expect(await count(s.t, "gl.grant_postings")).toBe(1);    // never a second register row
    // once posted, a further replay re-enqueues nothing
    const before = rowsOf(await scoped(s.t, (tx) => tx.execute(sql`SELECT 1 FROM _outbox.messages WHERE tenant_id = ${s.t}::uuid AND topic = ${COMMANDS.journalPost}`))).length;
    await scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), input));
    const after = rowsOf(await scoped(s.t, (tx) => tx.execute(sql`SELECT 1 FROM _outbox.messages WHERE tenant_id = ${s.t}::uuid AND topic = ${COMMANDS.journalPost}`))).length;
    expect(after).toBe(before);
    expect(await headNet(s.t, "1100", f)).toBe(100n);
  });
  it("a bank head that is not a leaf ASSET head (expense head, group account, unknown) is refused at accept", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f = await newFund(s.t, "BANKCHK");
    const parent = randomUUID();
    await scoped(s.t, (tx) => tx.insert(financeHeads).values([
      { id: parent, tenantId: s.t, code: "1190", name: "Bank group", level: 0, classification: "asset", createdBy: MAKER, updatedBy: MAKER },
      { id: randomUUID(), tenantId: s.t, code: "1191", name: "Bank leaf", level: 1, classification: "asset", parentId: parent, createdBy: MAKER, updatedBy: MAKER },
      { id: randomUUID(), tenantId: s.t, code: "5999", name: "Expense", level: 0, classification: "expense", createdBy: MAKER, updatedBy: MAKER },
    ]));
    const g = await scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "salary", 1_000n)));
    const rc = (bankHeadCode: string) => scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), { ...ev(g.id, 10n), bankHeadCode }));
    expect(await codeOf(rc("5999"))).toBe("GRANT_BANK_HEAD_INVALID");
    expect(await codeOf(rc("1190"))).toBe("GRANT_BANK_HEAD_INVALID");
    expect(await codeOf(rc("9999"))).toBe("GRANT_HEADS_MISSING");
    expect(await count(s.t, "gl.grant_postings")).toBe(0);
    expect(await codeOf(rc("1191"))).toBe("NO_ERROR");
  });
  it("M7: only INR is accepted as a grant currency (service and column CHECK)", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f = await newFund(s.t, "CCY");
    expect(await codeOf(scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), { ...grantInput(f, "general"), currency: "USD" })))).toBe("GRANT_CURRENCY");
    await expect(scoped(s.t, (tx) => tx.execute(sql`INSERT INTO gl.grants (tenant_id, fund_id, category, grantor, sanction_ref, sanction_date, amount_sanctioned_minor, currency, created_by, updated_by)
      VALUES (${s.t}::uuid, ${f}::uuid, 'general', 'G', 'C1', '2026-04-01', 5, 'USD', ${MAKER}::uuid, ${MAKER}::uuid)`))).rejects.toThrow();
  });
  it("B1b: a receipt dated in a DRAFT or a CLOSED financial year is refused 422 at accept (FY_NOT_ACTIVE / FY_CLOSED) and writes nothing", async () => {
    for (const [status, expected] of [["draft", "FY_NOT_ACTIVE"], ["closed", "FY_CLOSED"]] as const) {
      const s = await seedTenant({ fundAccounting: true });
      const f = await newFund(s.t, `FY-${status}`.toUpperCase());
      const g = await scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "salary", 1_000n)));
      await setFy(s.t, "2026-27", status);
      for (const op of [recordGrantReceiptTx, recogniseRevenueGrantTx]) {
        expect(await codeOf(scoped(s.t, (tx) => op(tx, meta(s.t), { grantId: g.id, amountMinor: 10n, postingDate: "2026-08-10" }))), `${status}/${op.name}`).toBe(expected);
      }
      expect(await count(s.t, "gl.grant_postings")).toBe(0);
      expect(await count(s.t, "gl.grant_utilisation")).toBe(0);
      expect((await scoped(s.t, (tx) => getGrantTx(tx, s.t, g.id))).grant.status).toBe("sanctioned");
      expect(rowsOf(await scoped(s.t, (tx) => tx.execute(sql`SELECT 1 FROM _outbox.messages WHERE tenant_id = ${s.t}::uuid AND topic = ${COMMANDS.journalPost}`))).length).toBe(0);
    }
  });
  it("B1c: the bank head and the capital-grant policy are stored on the posting row, and a replay rebuilds from the STORED values", async () => {
    const s = await seedTenant({ fundAccounting: true });
    const f = await newFund(s.t, "STORED");
    await scoped(s.t, (tx) => tx.insert(financeHeads).values({ id: randomUUID(), tenantId: s.t, code: "1120", name: "Bank 2", level: 0, classification: "asset", createdBy: MAKER, updatedBy: MAKER }));
    const g = await scoped(s.t, (tx) => createGrantTx(tx, meta(s.t), grantInput(f, "salary", 1_000n)));
    const id = randomUUID();
    const first = await scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), { ...ev(g.id, 50n, id), bankHeadCode: "1120" }));
    const row = await q1(s.t, sql`SELECT bank_head_code, capital_grant_policy FROM gl.grant_postings WHERE tenant_id = ${s.t}::uuid AND id = ${id}::uuid`);
    expect(row).toEqual([{ bank_head_code: "1120", capital_grant_policy: "deferred_income" }]);
    // no journal exists yet (nothing drained): a replay with a DIFFERENT bank head re-publishes the same journal from the STORED values
    await scoped(s.t, (tx) => recordGrantReceiptTx(tx, meta(s.t), { ...ev(g.id, 50n, id), bankHeadCode: "1100" }));
    expect(await drainGrantJournals(s.t)).toBe(0);
    expect(await headNet(s.t, "1120", f)).toBe(50n);
    expect(await headNet(s.t, "1100", f)).toBe(0n);
    expect(first.replayed).toBe(false);
  });
});
