/**
 * Section 8 NF-0 govt golden pins (docs/design/SECTION8-NONPROFIT-FINANCE.md §0 contract #4, §2.5, §10).
 * REAL Postgres -- the orchestrator runs this in a quiet window; it is NOT run by the NF-0 author.
 *
 * Captures the govt finance output for a seeded govt tenant -- full ledger rows, trial balance, I&E (profit-and-loss),
 * balance sheet, statements list and the year-end read -- and asserts it is BYTE-IDENTICAL:
 *   (1) with gl.finance_settings.fund_accounting OFF vs flipped ON for the same tenant, and
 *   (2) against a stored fixture (tests/fixtures/nf0-govt-golden.json) when one exists.
 * This is the regression net NF-1 must keep green: fund accounting must never change a govt tenant's numbers.
 *
 * Fixture capture: run ONCE on a checkout whose finance code is the S4 head (366c2d0f) plus migration 0170 applied (so the
 * ON-flip works), with NF0_WRITE_GOLDEN=1; commit the generated file. Without the fixture only (1) runs; (2) is skipped
 * with an explicit reason rather than silently passing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { purgeLedgerRows } from "./_purge-ledger.js";
import { scoped } from "./_tenant.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeLedger } from "../src/modules/gl/schema.js";
import { bearer } from "./_fp02.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, "fixtures/nf0-govt-golden.json");
const FY = "2026-27";
const PRIOR_FY_DATE = "2025-11-10";

// gl.finance_ledger is append-only: a fresh tenant per run, purged afterwards.
const T = randomUUID();
const ACTOR = "00000000-0f02-4000-8000-0000000000a0";
let app: Awaited<ReturnType<typeof buildApp>>;

const head = (code: string, classification: string) => ({
  id: randomUUID(), tenantId: T, code, name: `Head ${code}`, level: 0, classification, createdBy: ACTOR, updatedBy: ACTOR,
});
const H = {
  cash: head("1100", "asset"), fa: head("1200", "capital"), payable: head("2100", "liability"),
  fund: head("3100", "fund"), income: head("4100", "income"), expense: head("5100", "expense"), expense2: head("5200", "expense"),
};
const line = (h: { id: string }, voucherNo: string, postingDate: string, debitMinor: bigint, creditMinor: bigint) => ({
  tenantId: T, headId: h.id, voucherNo, postingDate, debitMinor, creditMinor,
  balanceMinor: debitMinor - creditMinor, createdBy: ACTOR, updatedBy: ACTOR,
});

const get = async (url: string) => {
  const res = await app.inject({ method: "GET", url, headers: bearer(T, ACTOR, ["finance_officer"]) });
  return { status: res.statusCode, body: res.json() as unknown };
};

/** Replace every uuid and the run's tenant id so two runs / two tenants compare equal; key order is made canonical. */
function canon(v: unknown): string {
  const sorted = (x: unknown): unknown => Array.isArray(x) ? x.map(sorted)
    : x && typeof x === "object" ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, sorted((x as Record<string, unknown>)[k])]))
    : x;
  return JSON.stringify(sorted(v)).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>");
}

async function ledgerRows() {
  const res = await scoped(T, (tx) => tx.execute(sql`
    SELECT fh.code AS head_code, fl.voucher_no, fl.posting_date::text AS posting_date,
           fl.debit_minor::text AS debit_minor, fl.credit_minor::text AS credit_minor, fl.balance_minor::text AS balance_minor
      FROM gl.finance_ledger fl JOIN budget.finance_heads fh ON fh.id = fl.head_id AND fh.tenant_id = fl.tenant_id
     WHERE fl.tenant_id = ${T}::uuid ORDER BY fl.voucher_no, fh.code, fl.debit_minor, fl.credit_minor`));
  return (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as unknown[];
}

/** GET /v1/finance/statements has no ORDER BY (row order is heap/uuid dependent and varies between runs); compare it as a set by sorting on its value columns. Every value is still compared. */
function sortStatements(r: { status: number; body: unknown }) {
  if (!Array.isArray(r.body)) return r;
  const key = (x: Record<string, unknown>) => [x.type, x.receipts, x.payments, x.closingBalance, x.openingBalance].join("|");
  return { ...r, body: [...(r.body as Record<string, unknown>[])].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)) };
}

async function snapshot() {
  return {
    ledger: await ledgerRows(),
    trialBalance: await get(`/v1/finance/statements/trial-balance-check?fy=${FY}`),
    incomeExpenditure: await get(`/v1/finance/statements/income-expenditure?fy=${FY}`),
    profitAndLoss: await get(`/v1/finance/statements/profit-and-loss?fy=${FY}`),
    balanceSheet: await get(`/v1/finance/statements/balance-sheet?fy=${FY}`),
    statements: sortStatements(await get(`/v1/finance/statements`)),
    yearEnd: await get(`/v1/finance/year-end/${FY}`),
    yearEndPrior: await get(`/v1/finance/year-end/2025-26`),
  };
}

const setFundAccounting = (on: boolean | null) => scoped(T, (tx) => tx.execute(sql`
  INSERT INTO gl.finance_settings (tenant_id, updated_by, fund_accounting) VALUES (${T}::uuid, ${ACTOR}::uuid, ${on})
  ON CONFLICT (tenant_id) DO UPDATE SET fund_accounting = EXCLUDED.fund_accounting`));

beforeAll(async () => {
  app = await buildApp();
  await scoped(T, (tx) => tx.insert(financeHeads).values(Object.values(H)));
  await scoped(T, (tx) => tx.insert(financeLedger).values([
    // prior FY (gives the year-end/derived opening something to carry): fund 5,00,000.00 funded in cash, 1,20,000.00 of assets bought
    line(H.cash, "G-0001", PRIOR_FY_DATE, 50000000n, 0n), line(H.fund, "G-0001", PRIOR_FY_DATE, 0n, 50000000n),
    line(H.fa, "G-0002", PRIOR_FY_DATE, 12000000n, 0n), line(H.cash, "G-0002", PRIOR_FY_DATE, 0n, 12000000n),
    // current FY: receipt, two expenditures (one on credit), an odd-paise amount
    line(H.cash, "G-0101", "2026-05-02", 7500050n, 0n), line(H.income, "G-0101", "2026-05-02", 0n, 7500050n),
    line(H.expense, "G-0102", "2026-06-15", 2500025n, 0n), line(H.cash, "G-0102", "2026-06-15", 0n, 2500025n),
    line(H.expense2, "G-0103", "2026-08-01", 1234567n, 0n), line(H.payable, "G-0103", "2026-08-01", 0n, 1234567n),
  ]));
});
afterAll(async () => {
  await app.close();
  await purgeLedgerRows(T, sql`true`);
  await sqlClient.end();
});

describe("NF-0 govt golden: finance output is byte-identical with fund_accounting OFF and ON", () => {
  it("the seeded ledger produces a non-trivial snapshot (guards against pinning an empty/error response)", async () => {
    const s = await snapshot();
    expect((s.ledger as unknown[]).length).toBe(10);
    for (const k of ["trialBalance", "incomeExpenditure", "profitAndLoss", "balanceSheet", "statements", "yearEnd"] as const) {
      expect(s[k].status, k).toBe(200);
    }
  });

  it("OFF (no settings row), OFF (NULL), OFF (false) and ON all yield the identical snapshot", async () => {
    const base = canon(await snapshot());                 // no gl.finance_settings row at all
    await setFundAccounting(null);  expect(canon(await snapshot())).toBe(base);
    await setFundAccounting(false); expect(canon(await snapshot())).toBe(base);
    await setFundAccounting(true);  expect(canon(await snapshot())).toBe(base);
    await setFundAccounting(false);
  });

  const capture = process.env.NF0_WRITE_GOLDEN === "1";
  // FLAKY-SKIP: env-gated — runs whenever the committed golden fixture exists (always in the CI Tests job); skips only during first-time capture (NF0_WRITE_GOLDEN=1) before the fixture is written (expires: 2027-05-31)
  it.skipIf(!capture && !existsSync(FIXTURE))("matches the stored govt golden fixture (tests/fixtures/nf0-govt-golden.json)", async () => {
    const now = canon(await snapshot());
    if (capture) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, JSON.stringify(JSON.parse(now), null, 2) + "\n");
      return;
    }
    expect(now).toBe(canon(JSON.parse(readFileSync(FIXTURE, "utf8"))));
  });
});
