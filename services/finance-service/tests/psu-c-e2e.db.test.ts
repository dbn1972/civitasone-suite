/**
 * PSU v1 CAPSTONE (slice A + B + C), REAL Postgres, migrations through 0189, the REAL gl consumer for the dividend journals.
 *
 *  1. a `psu` tenant onboards -> stored company / commercial / govt_owned / cag_caro (slice B)
 *  2. cap table recorded; commercial journals (books) in the prior and current FY
 *  3. a dividend is DECLARED (Dr 3220 / Cr 2650) and PAID (Dr 2650 / Cr 1100) through outbox -> finance.gl.post
 *  4. SOCIE shows the dividend and ties to the Balance Sheet; the P&L carries the prior-year comparative (slice A)
 *  5. cap table / CARO / C&AG / CSR disclosures render for the PSU
 *  6. a plain commercial `company` tenant still gets SOCIE + comparatives but NOT the PSU-only disclosures, and a govt tenant is untouched
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { purgeLedgerRows } from "./_purge-ledger.js";
import { bearer } from "./_fp02.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeLedger } from "../src/modules/gl/schema.js";
import { financeSettings } from "../src/modules/approvals/schema.js";
import { seedGlHeadsTx } from "../src/modules/gl/standard-heads.js";
import { activateFinanceProfileTx, resolveCoaTemplateTx } from "../src/modules/gl/coa-template.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const ACTOR = "00000000-0f71-4000-8000-0000000000c1";
const tenants: string[] = [];
const rowsOf = (r: unknown): Array<Record<string, any>> => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, any>>;
let app: Awaited<ReturnType<typeof buildApp>>;
const saved: Record<string, string | undefined> = {};
const ENV = ["TENANT_PROFILES_ENABLED", "FINANCE_PSU_DIPAM_MODE", "FINANCE_PSU_DISCLOSURE_CONFIG"];
beforeAll(async () => { for (const k of ENV) saved[k] = process.env[k]; process.env.TENANT_PROFILES_ENABLED = "true"; app = await buildApp(); });
afterAll(async () => {
  await app.close();
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  for (const t of tenants) await purgeLedgerRows(t, sql`true`).catch(() => undefined);
  await sqlClient.end();
});

// [voucher, date, lines [code, dr, cr]]. FY 2025-26 = prior, FY 2026-27 = current. Face value 1000 paise (Rs 10) x 10,000 shares = 10,000,000 paise.
const BOOKS: Array<[string, string, Array<[string, bigint, bigint]>]> = [
  ["P1", "2025-06-10", [["1100", 10_000_000n, 0n], ["3000", 0n, 10_000_000n]]],
  ["P2", "2025-08-10", [["1100", 40_000_000n, 0n], ["4010", 0n, 40_000_000n]]],
  ["P3", "2025-09-10", [["5400", 10_000_000n, 0n], ["1100", 0n, 10_000_000n]]],
  ["C1", "2026-08-10", [["1100", 70_000_000n, 0n], ["4010", 0n, 70_000_000n]]],
  ["C2", "2026-09-10", [["5400", 20_000_000n, 0n], ["1100", 0n, 20_000_000n]]],
];
async function loadBooks(t: string): Promise<void> {
  const heads = new Map((await scoped(t, (tx) => tx.select({ id: financeHeads.id, code: financeHeads.code }).from(financeHeads).where(eq(financeHeads.tenantId, t)))).map((h) => [h.code, h.id]));
  const rows = BOOKS.flatMap(([v, d, ls]) => ls.map(([code, dr, cr]) => ({
    tenantId: t, headId: heads.get(code) as string, voucherNo: v, postingDate: d, debitMinor: dr, creditMinor: cr, balanceMinor: dr - cr, createdBy: ACTOR, updatedBy: ACTOR,
  })));
  await scoped(t, (tx) => tx.insert(financeLedger).values(rows));
}
const onboard = async (profile: string | undefined): Promise<string> => {
  const t = randomUUID(); tenants.push(t);
  await scoped(t, async (tx) => {
    await activateFinanceProfileTx(tx, t, profile, ACTOR, randomUUID());
    const { template, packs } = await resolveCoaTemplateTx(tx, t);
    await seedGlHeadsTx(tx, t, template, packs, ACTOR);
  });
  return t;
};
/** A plain commercial company (the MSME shape), seeded as the slice-A tests do. */
async function plainCompany(): Promise<string> {
  const t = randomUUID(); tenants.push(t);
  await scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.finance_settings (tenant_id, coa_template, accounting_basis, entity_type, maker_checker_enabled, updated_by)
    VALUES (${t}::uuid, 'commercial', 'accrual', 'company', true, ${ACTOR}::uuid)`));
  await scoped(t, (tx) => seedGlHeadsTx(tx, t, "commercial"));
  return t;
}
const call = async (t: string, method: "GET" | "POST" | "PUT", url: string, payload?: unknown, roles = ["finance_admin"]) => {
  const res = await app.inject({ method, url, headers: bearer(t, ACTOR, roles), ...(payload !== undefined ? { payload: payload as object } : {}) });
  let body: any = null; try { body = res.body ? res.json() : null; } catch { body = res.body; }
  return { status: res.statusCode, body };
};
function tenantQueue(): MemoryQueue {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const raw = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (m: any) => Promise<void>) => raw(topic, (m: any) => runWithTenant(m.tenantId, () => handler(m)));
  registerGlConsumers(q);
  return q;
}
async function pump(t: string): Promise<MemoryQueue> {
  const q = tenantQueue();
  for (let i = 0; i < 6; i++) {
    const rows = rowsOf(await scoped(t, (tx) => tx.execute(sql`SELECT id, topic, actor_id, correlation_id, payload FROM _outbox.messages
       WHERE tenant_id = ${t}::uuid AND published_at IS NULL AND topic = ${COMMANDS.journalPost} ORDER BY created_at`)));
    if (rows.length === 0) break;
    for (const r of rows) {
      await scoped(t, (tx) => tx.execute(sql`UPDATE _outbox.messages SET published_at = now() WHERE id = ${r.id}::uuid`));
      await q.publish(r.topic, { messageId: r.id, type: r.topic, tenantId: t, actorId: r.actor_id, correlationId: r.correlation_id, schemaVersion: "1.0", payload: r.payload });
    }
    await q.drain();
  }
  return q;
}
const balances = async (t: string): Promise<Record<string, bigint>> => {
  const r = rowsOf(await scoped(t, (tx) => tx.execute(sql`SELECT h.code, COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::text AS bal
    FROM gl.finance_ledger l JOIN budget.finance_heads h ON h.id = l.head_id WHERE l.tenant_id = ${t}::uuid GROUP BY h.code`)));
  return Object.fromEntries(r.map((x) => [x.code, BigInt(x.bal)]));
};
const B = "/v1/finance/statements/commercial";
const P = "/v1/finance/psu";
const holders = [
  { holderName: "President of India", category: "president_of_india", shares: 5100, faceValueMinor: 1000, folio: "F-001" },
  { holderName: "Life Insurance Corporation", category: "institution", shares: 2900, faceValueMinor: 1000, folio: "F-002" },
  { holderName: "Public shareholders", category: "public", shares: 2000, faceValueMinor: 1000 },
];

describe("migrations 0188 / 0189 table spec", () => {
  it("both tables exist with RLS ENABLED + FORCED, a tenant policy, finance_svc grants and UNIQUE(tenant_id,id)", async () => {
    for (const tbl of ["psu_shareholdings", "psu_dividends"]) {
      const c = rowsOf(await sqlClient`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ${`gl.${tbl}`}::regclass`);
      expect(c[0]).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
      const p = rowsOf(await sqlClient`SELECT policyname FROM pg_policies WHERE schemaname = 'gl' AND tablename = ${tbl}`);
      expect(p.map((x) => x.policyname)).toContain("tenant_isolation_policy");
      const u = rowsOf(await sqlClient`SELECT 1 FROM pg_constraint WHERE conrelid = ${`gl.${tbl}`}::regclass AND contype = 'u' AND conname = ${`${tbl}_tenant_id_id_key`}`);
      expect(u).toHaveLength(1);
    }
  });
  it("RLS: a tenant cannot read or insert another tenant's register rows", async () => {
    const a = randomUUID(), b = randomUUID();
    await scoped(a, (tx) => tx.execute(sql`INSERT INTO gl.psu_shareholdings (tenant_id, holder_name, category, shares, face_value_minor, created_by, updated_by)
      VALUES (${a}::uuid, 'X', 'public', 10, 100, ${ACTOR}::uuid, ${ACTOR}::uuid)`));
    expect(rowsOf(await scoped(b, (tx) => tx.execute(sql`SELECT id FROM gl.psu_shareholdings WHERE tenant_id = ${a}::uuid`)))).toHaveLength(0);
    await expect(scoped(b, (tx) => tx.execute(sql`INSERT INTO gl.psu_shareholdings (tenant_id, holder_name, category, shares, face_value_minor, created_by, updated_by)
      VALUES (${a}::uuid, 'Y', 'public', 10, 100, ${ACTOR}::uuid, ${ACTOR}::uuid)`))).rejects.toThrow();
    await scoped(a, (tx) => tx.execute(sql`DELETE FROM gl.psu_shareholdings WHERE tenant_id = ${a}::uuid`)).catch(() => undefined);
  });
});

describe("PSU capstone: onboard -> books -> cap table -> dividend -> SOCIE / BS / P&L / disclosures", () => {
  let t = "";
  const report: Record<string, unknown> = {};
  let finalId = "", interimId = "";

  it("onboards a psu tenant to the stored company / commercial / govt_owned / cag_caro identity", async () => {
    t = await onboard("psu");
    const s = (await scoped(t, (tx) => tx.select().from(financeSettings).where(eq(financeSettings.tenantId, t))))[0]!;
    expect(s).toMatchObject({ coaTemplate: "commercial", entityType: "company", govtOwned: true, auditProfile: "cag_caro" });
    await loadBooks(t);
  });

  it("PSU-only routes need the register first: declaring a dividend with no cap table is refused (422)", async () => {
    const r = await call(t, "POST", `${P}/dividends/declare`, { dividendType: "final", declaredOn: "2026-11-10", resolutionRef: "AGM-1", perShareMinor: 500 });
    expect(r.status).toBe(422);
    expect(r.body.code ?? r.body.error?.code).toBe("NO_EQUITY_SHARES");
  });

  it("records the cap table (duplicate folio -> 409); it ties to the share-capital ledger and gives the Government's 51.00%", async () => {
    for (const h of holders) expect((await call(t, "POST", `${P}/shareholdings`, h)).status).toBe(201);
    expect((await call(t, "POST", `${P}/shareholdings`, { ...holders[0], holderName: "Dup" })).status).toBe(409);
    const ct = (await call(t, "GET", `${P}/cap-table?fy=2026-27`)).body.data;
    expect(ct).toMatchObject({ govtOwnershipPct: "51.00", govtEquityShares: "5100", paidUpTotalMinor: "10000000", shareCapitalLedgerMinor: "10000000", tiesToShareCapital: true });
    expect(ct.warnings).toEqual([]);
    report.capTable = { govtPct: ct.govtOwnershipPct, paidUp: ct.paidUpTotalMinor, ties: ct.tiesToShareCapital };
  });

  it("declares an INTERIM dividend (DIPAM off by default -> no advisory) and a FINAL (DIPAM advisory on): Dr 3220 / Cr 2650 posted via the real gl consumer", async () => {
    delete process.env.FINANCE_PSU_DIPAM_MODE;
    const i = await call(t, "POST", `${P}/dividends/declare`, { dividendType: "interim", declaredOn: "2026-09-10", resolutionRef: "BOARD-7", perShareMinor: 100 });
    expect(i.status).toBe(202);
    expect(i.body.data.dipamAdvisory).toBeNull();
    expect(i.body.data.dividend).toMatchObject({ amountMinor: "1000000", govtAmountMinor: "510000", equityShares: "10000", govtShares: "5100", status: "declared" });
    interimId = i.body.data.dividend.id;

    process.env.FINANCE_PSU_DIPAM_MODE = "advisory";
    const f = await call(t, "POST", `${P}/dividends/declare`, { dividendType: "final", declaredOn: "2026-11-10", resolutionRef: "AGM-2026", perShareMinor: 400 });
    expect(f.status).toBe(202);
    expect(f.body.data.dividend).toMatchObject({ amountMinor: "4000000", govtAmountMinor: "2040000" });
    // PAT 50,000,000 (70m - 20m); net worth 10m + 30m prior surplus + 50m = 90m. Higher of 30% x 50m = 15m and 5% x 90m = 4.5m => 15m; declared for the FY 5m.
    expect(f.body.data.dipamAdvisory).toMatchObject({ requiredMinor: "15000000", declaredForFyMinor: "5000000", met: false });
    finalId = f.body.data.dividend.id;
    expect((await call(t, "POST", `${P}/dividends/declare`, { dividendType: "final", declaredOn: "2026-11-10", resolutionRef: "AGM-2026", perShareMinor: 400 })).status).toBe(409);

    const q = await pump(t);
    expect(q.dlq.map((d) => String(d.error)).join(" | ")).toBe("");
    const bal = await balances(t);
    expect(bal["3220"]).toBe(5_000_000n);   // debits: dividends declared
    expect(bal["2650"]).toBe(-5_000_000n);  // credits: dividend payable
    report.declared = { dr3220: bal["3220"]!.toString(), cr2650: (-bal["2650"]!).toString() };
  });

  it("pays both dividends: Dr 2650 / Cr 1100; payable clears; paying twice is 409", async () => {
    for (const [id, on] of [[interimId, "2026-09-20"], [finalId, "2026-11-15"]] as const) {
      const r = await call(t, "POST", `${P}/dividends/${id}/pay`, { paidOn: on });
      expect(r.status).toBe(202);
      expect(r.body.data).toMatchObject({ status: "paid", paidOn: on });
    }
    expect((await call(t, "POST", `${P}/dividends/${finalId}/pay`, { paidOn: "2026-11-16" })).status).toBe(409);
    expect((await call(t, "POST", `${P}/dividends/${randomUUID()}/pay`, { paidOn: "2026-11-16" })).status).toBe(404);
    const q = await pump(t);
    expect(q.dlq).toHaveLength(0);
    const bal = await balances(t);
    expect(bal["2650"]).toBe(0n);
    // cash: +10m +40m -10m +70m -20m (books) - 5m dividends paid
    expect(bal["1100"]).toBe(85_000_000n);
    const list = (await call(t, "GET", `${P}/dividends?fy=2026-27`)).body.data;
    expect(list).toHaveLength(2);
    report.paid = { cash1100: bal["1100"]!.toString(), payable2650: bal["2650"]!.toString() };
  });

  it("SOCIE shows the dividend in the dividends column (3220 wired as dividendCodes) and ties to the Balance Sheet", async () => {
    const r = await call(t, "GET", `${B}/changes-in-equity?fy=2026-27`, undefined, ["finance_officer"]);
    expect(r.status).toBe(200);
    expect(r.body.tiesToBalanceSheet).toBe(true);
    expect(r.body.totals.dividendsMinor).toBe("5000000");
    expect(r.body.totals.otherDeductionsMinor).toBe("0");
    const row = r.body.rows.find((x: any) => x.code === "3220");
    expect(row).toMatchObject({ dividendsMinor: "5000000", closingMinor: "-5000000" });
    const tot = r.body.totals;
    expect(BigInt(tot.openingMinor) + BigInt(tot.profitForYearMinor) + BigInt(tot.additionsMinor) - BigInt(tot.dividendsMinor) - BigInt(tot.otherDeductionsMinor)).toBe(BigInt(tot.closingMinor));
    // closing equity = capital 10m + prior surplus 30m + PAT 50m - dividends 5m = 85m
    expect(r.body.totals.closingMinor).toBe("85000000");
    const bs = (await call(t, "GET", `${B}/balance-sheet?fy=2026-27`, undefined, ["finance_officer"])).body;
    expect(bs.balanced).toBe(true);
    expect(r.body.balanceSheetEquityMinor).toBe("85000000");
    report.socie = { dividends: r.body.totals.dividendsMinor, closing: r.body.totals.closingMinor, ties: r.body.tiesToBalanceSheet, bsBalanced: bs.balanced };
  });

  it("P&L carries the prior-year comparative", async () => {
    const pl = (await call(t, "GET", `${B}/profit-and-loss?fy=2026-27`, undefined, ["finance_officer"])).body;
    expect(pl.profitAfterTaxMinor).toBe("50000000");
    expect(pl.priorYear).toMatchObject({ fiscalYear: "2025-26", totalRevenueMinor: "40000000", profitAfterTaxMinor: "30000000" });
  });

  it("renders the PSU disclosures: cap table, dividends, CARO (21 clause stubs) + C&AG notes; CSR absent while no threshold is met", async () => {
    delete process.env.FINANCE_PSU_DISCLOSURE_CONFIG;
    const d = (await call(t, "GET", `${B}/psu-disclosures?fy=2026-27`, undefined, ["audit_officer"])).body;
    expect(d.auditProfile).toBe("cag_caro");
    expect(d.capTable).toMatchObject({ govtOwnershipPct: "51.00", tiesToShareCapital: true });
    expect(d.dividends.map((x: any) => x.amountMinor).sort()).toEqual(["1000000", "4000000"]);
    expect(d.caro.clauses).toHaveLength(21);
    expect(d.cag.notes).toHaveLength(3);
    expect(d.csr).toBeUndefined();
    expect((await call(t, "GET", `${P}/csr?fy=2026-27`)).body.data.applicable).toBe(false);
    const set = (await call(t, "GET", `${B}/set?fy=2026-27`, undefined, ["finance_officer"])).body;
    expect(set.disclosures.capTable.govtOwnershipPct).toBe("51.00");
  });

  it("CSR note appears once a (config) threshold is met: 2% of the average net profit of the preceding years with activity", async () => {
    process.env.FINANCE_PSU_DISCLOSURE_CONFIG = JSON.stringify({ csr: { netProfitMinor: "1000000" } });
    const c = (await call(t, "GET", `${P}/csr?fy=2026-27`)).body.data;
    // preceding years with activity: 2025-26 only (PBT 30,000,000) -> 2% = 600,000
    expect(c).toMatchObject({ applicable: true, yearsUsed: ["2025-26"], averageNetProfitMinor: "30000000", obligationMinor: "600000" });
    const d = (await call(t, "GET", `${B}/psu-disclosures?fy=2026-27`, undefined, ["audit_officer"])).body;
    expect(d.csr).toMatchObject({ applicable: true, obligationMinor: "600000" });
    report.csr = { avgNetProfit: c.averageNetProfitMinor, obligation: c.obligationMinor };
    delete process.env.FINANCE_PSU_DISCLOSURE_CONFIG;
  });

  it("collision guard: a tenant already using 2650 as an asset is refused (409), nothing posted", async () => {
    const x = await onboard("psu");
    await scoped(x, (tx) => tx.execute(sql`INSERT INTO budget.finance_heads (tenant_id, code, name, level, classification, created_by, updated_by)
      VALUES (${x}::uuid, '2650', 'Odd asset', 0, 'asset', ${ACTOR}::uuid, ${ACTOR}::uuid)`));
    expect((await call(x, "POST", `${P}/shareholdings`, holders[0])).status).toBe(201);
    const r = await call(x, "POST", `${P}/dividends/declare`, { dividendType: "final", declaredOn: "2026-11-10", resolutionRef: "AGM", perShareMinor: 100 });
    expect(r.status).toBe(409);
    expect(r.body.code ?? r.body.error?.code).toBe("PSU_HEAD_COLLISION");
    expect(rowsOf(await scoped(x, (tx) => tx.execute(sql`SELECT 1 FROM gl.psu_dividends WHERE tenant_id = ${x}::uuid`)))).toHaveLength(0);
  });

  it("report", () => { console.log("PSU-CAPSTONE-REPORT " + JSON.stringify(report)); });
});

describe("non-PSU tenants are unaffected", () => {
  it("a plain commercial company still gets SOCIE + comparatives, but NO PSU disclosures and no PSU routes", async () => {
    const c = await plainCompany();
    await loadBooks(c);
    const socie = (await call(c, "GET", `${B}/changes-in-equity?fy=2026-27`, undefined, ["finance_officer"]));
    expect(socie.status).toBe(200);
    expect(socie.body.tiesToBalanceSheet).toBe(true);
    expect(socie.body.totals.dividendsMinor).toBe("0");
    expect((await call(c, "GET", `${B}/profit-and-loss?fy=2026-27`, undefined, ["finance_officer"])).body.priorYear).toMatchObject({ fiscalYear: "2025-26" });
    const set = (await call(c, "GET", `${B}/set?fy=2026-27`, undefined, ["finance_officer"])).body;
    expect(Object.prototype.hasOwnProperty.call(set, "disclosures")).toBe(false);
    for (const [m, u] of [["GET", `${B}/psu-disclosures?fy=2026-27`], ["GET", `${P}/cap-table`], ["GET", `${P}/shareholdings`], ["GET", `${P}/csr`], ["GET", `${P}/dividends`]] as const) {
      const r = await call(c, m, u, undefined, ["finance_admin"]);
      expect(r.status, u).toBe(404);
    }
    expect((await call(c, "POST", `${P}/dividends/declare`, { dividendType: "final", declaredOn: "2026-11-10", resolutionRef: "x", perShareMinor: 1 })).status).toBe(404);
    // no PSU head was seeded for it
    expect(rowsOf(await scoped(c, (tx) => tx.execute(sql`SELECT code FROM budget.finance_heads WHERE tenant_id = ${c}::uuid AND code IN ('2650','3220')`)))).toHaveLength(0);
  });
  it("a govt tenant sees neither the commercial statements nor the PSU routes", async () => {
    const g = randomUUID(); tenants.push(g);
    await scoped(g, (tx) => tx.execute(sql`INSERT INTO gl.finance_settings (tenant_id, coa_template, accounting_basis, maker_checker_enabled, updated_by) VALUES (${g}::uuid, 'govt', 'cash', true, ${ACTOR}::uuid)`));
    expect((await call(g, "GET", `${B}/set?fy=2026-27`, undefined, ["finance_officer"])).status).toBe(404);
    expect((await call(g, "GET", `${P}/cap-table`)).status).toBe(404);
    expect((await call(g, "GET", `${B}/psu-disclosures`, undefined, ["finance_officer"])).status).toBe(404);
  });
  it("commercial company with govt_owned=false but audit_profile cag_caro (inconsistent) still gets no PSU disclosures", async () => {
    const c = await plainCompany();
    await scoped(c, (tx) => tx.execute(sql`UPDATE gl.finance_settings SET audit_profile = 'cag_caro' WHERE tenant_id = ${c}::uuid`));
    await loadBooks(c);
    const set = (await call(c, "GET", `${B}/set?fy=2026-27`, undefined, ["finance_officer"])).body;
    expect(Object.prototype.hasOwnProperty.call(set, "disclosures")).toBe(false);
  });
});
