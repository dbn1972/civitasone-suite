/**
 * Section 8 NF-3 (grants-in-aid): pure logic, no database. Policy -> head mapping, per-category routing, per-fund balancing,
 * running-total headroom, the head-code single source + override-collision guard, the settings-read wiring and static guards.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SRC, listTs, read, rel, stripComments } from "./_nf0-static.js";
import {
  GRANT_HEAD_CODES, assertGrantHeadCodes, reservedSystemCodes, FUND_HEAD_CODES, GrantHeadCodeError, type GrantHeadCodes,
} from "../src/modules/gl/system-heads.js";
import { glHeadsForTemplate, coreGlHeads } from "../src/modules/gl/standard-heads.js";
import { assertFundsBalanced } from "../src/modules/gl/funds.js";
import { loadPostingSettingsTx, toCapitalGrantPolicy } from "../src/modules/approvals/posting-settings.js";
import {
  receiptCreditHead, recognitionHeads, buildGrantReceipt, buildRevenueRecognition, buildCapitalisation, buildCapitalRelease,
  buildGrantJournal, assertHeadroom, unspentMinor, ZERO_TOTALS, type GrantCategory, type CapitalGrantPolicy,
} from "../src/modules/grants/domain.js";

const F = "11111111-1111-4111-8111-111111111111";
const H = GRANT_HEAD_CODES();
const base = (category: GrantCategory, policy: CapitalGrantPolicy, amountMinor = 1000n) => ({ category, policy, fundId: F, amountMinor });
const net = (lines: Array<{ accountCode: string; debitMinor: bigint | number | string; creditMinor: bigint | number | string }>) => {
  const m = new Map<string, bigint>();
  for (const l of lines) m.set(l.accountCode, (m.get(l.accountCode) ?? 0n) + BigInt(l.debitMinor) - BigInt(l.creditMinor));
  return m;
};
const codeOf = async (fn: () => unknown): Promise<string> => { try { await fn(); return "NO_ERROR"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

const savedEnv = { ...process.env };
afterEach(() => { for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]; Object.assign(process.env, savedEnv); });

describe("NF-3 head codes: one source, defaults match the brief", () => {
  it("defaults", () => {
    expect(H).toEqual({
      revenueReceiptSalary: "2320", revenueReceiptGeneral: "2330", revenueIncomeSalary: "4430", revenueIncomeGeneral: "4440",
      capitalReceipt: "2340", capitalDeferred: "2350", capitalRelease: "4450", capitalFund: "3300",
    });
  });
  it("the nonprofit chart seeds exactly these codes (chart and posting cannot drift)", () => {
    const chart = new Map(glHeadsForTemplate("nonprofit").map((h) => [h.code, h]));
    for (const code of Object.values(H)) expect(chart.has(code), code).toBe(true);
    expect(chart.get(H.capitalDeferred)?.statementClass).toBe("non_current_liability");
    expect(chart.get(H.capitalFund)?.statementClass).toBe("capital_reserve");
  });
  it("an override is honoured by BOTH the grants head set and the seeded chart", () => {
    process.env.FINANCE_GRANT_CAP_DEFERRED_CODE = "2355";
    expect(GRANT_HEAD_CODES().capitalDeferred).toBe("2355");
    const chart = glHeadsForTemplate("nonprofit").map((h) => h.code);
    expect(chart).toContain("2355");
    expect(chart).not.toContain("2350");
    expect(buildCapitalisation(base("capital", "deferred_income")).map((l) => l.accountCode)).toContain("2355");
  });
  it("an empty override falls back to the default", () => {
    process.env.FINANCE_GRANT_CAP_FUND_CODE = "  ";
    expect(GRANT_HEAD_CODES().capitalFund).toBe("3300");
  });
});

describe("NF-3 override-collision guard (fail-safe)", () => {
  it("refuses an override that lands on an inter-fund (NF-1) head", () => {
    process.env.FINANCE_GRANT_CAP_RECEIPT_CODE = FUND_HEAD_CODES().dueTo;
    expect(() => GRANT_HEAD_CODES()).toThrow(/GRANT_HEAD_CODE_COLLISION/);
  });
  it("refuses an override that lands on a core system head (cash, depreciation, accumulated fund, payroll deduction)", () => {
    for (const [env, code] of [
      ["FINANCE_GRANT_REV_RECEIPT_SALARY_CODE", "1100"], ["FINANCE_GRANT_REV_INCOME_GENERAL_CODE", "5100"],
      ["FINANCE_GRANT_CAP_FUND_CODE", "3100"], ["FINANCE_GRANT_CAP_DEFERRED_CODE", "2104"],
    ] as const) {
      process.env[env] = code;
      expect(() => GRANT_HEAD_CODES(), `${env}=${code}`).toThrow(GrantHeadCodeError);
      delete process.env[env];
    }
  });
  it("refuses two grant roles sharing one code, and a malformed code", () => {
    process.env.FINANCE_GRANT_CAP_RELEASE_CODE = "4430";
    expect(() => GRANT_HEAD_CODES()).toThrow(/share the code 4430/);
    delete process.env.FINANCE_GRANT_CAP_RELEASE_CODE;
    process.env.FINANCE_GRANT_CAP_RELEASE_CODE = "bad code!";
    expect(() => GRANT_HEAD_CODES()).toThrow(/invalid code/);
  });
  it("the pure guard takes an explicit reserved set; the chart seeding also checks against the core chart codes", () => {
    expect(() => assertGrantHeadCodes(H, ["2340"])).toThrow(/collides/);
    expect(() => assertGrantHeadCodes(H, [])).not.toThrow();
    const core = coreGlHeads().map((h) => h.code);
    for (const c of Object.values(H)) expect(core, `default grant code ${c} must not be a core chart code`).not.toContain(c);
    expect(reservedSystemCodes()).toContain("1100");
    process.env.FINANCE_GRANT_REV_INCOME_SALARY_CODE = core[0] as string;
    expect(() => glHeadsForTemplate("nonprofit")).toThrow(/GRANT_HEAD_CODE_COLLISION/);
  });
  it("an override that lands on another nonprofit-template head (not just a core one) is refused rather than silently dropped by the chart de-dupe", () => {
    process.env.FINANCE_GRANT_REV_INCOME_SALARY_CODE = "4460";
    expect(() => glHeadsForTemplate("nonprofit")).toThrow(/GRANT_HEAD_CODE_COLLISION/);
  });
  it("M3: the RUNTIME guard (GRANT_HEAD_CODES, no seeding involved) also rejects an override on a seeded core / nonprofit chart code", () => {
    const core = coreGlHeads().map((h) => h.code);
    const ap = core.find((c) => c === "2050") ?? core[0] as string;
    process.env.FINANCE_GRANT_CAP_RECEIPT_CODE = ap;
    expect(() => GRANT_HEAD_CODES()).toThrow(/GRANT_HEAD_CODE_COLLISION/);
    process.env.FINANCE_GRANT_CAP_RECEIPT_CODE = "4460"; // another nonprofit-template head
    expect(() => GRANT_HEAD_CODES()).toThrow(/GRANT_HEAD_CODE_COLLISION/);
    delete process.env.FINANCE_GRANT_CAP_RECEIPT_CODE;
    expect(() => GRANT_HEAD_CODES()).not.toThrow();
  });
  it("a bad override never affects govt / commercial charts (the grant codes are read only by the nonprofit template and the grants module)", () => {
    process.env.FINANCE_GRANT_CAP_RECEIPT_CODE = "1100";
    expect(() => glHeadsForTemplate("govt")).not.toThrow();
    expect(() => glHeadsForTemplate("commercial")).not.toThrow();
  });
});

describe("NF-3 policy -> head mapping and per-category routing", () => {
  it("receipt credit head: salary 2320, general 2330; capital 2340 under deferred_income, 3300 under capital_fund", () => {
    expect(receiptCreditHead("salary", "deferred_income")).toBe("2320");
    expect(receiptCreditHead("general", "deferred_income")).toBe("2330");
    expect(receiptCreditHead("capital", "deferred_income")).toBe("2340");
    expect(receiptCreditHead("capital", "capital_fund")).toBe("3300");
    // the revenue categories ignore the capital policy
    expect(receiptCreditHead("salary", "capital_fund")).toBe("2320");
    expect(receiptCreditHead("general", "capital_fund")).toBe("2330");
  });
  it("recognition: salary 2320->4430, general 2330->4440; a capital grant is never recognised by utilisation", () => {
    expect(recognitionHeads("salary")).toEqual({ debit: "2320", credit: "4430" });
    expect(recognitionHeads("general")).toEqual({ debit: "2330", credit: "4440" });
    expect(() => recognitionHeads("capital")).toThrow(/GRANT_CATEGORY|capital grant is recognised/);
  });
  it("the four journals have the brief's shapes (Dr bank / Cr liability; Dr liability / Cr income; Dr 2340 / Cr 2350; Dr 2350 / Cr 4450)", () => {
    const r = buildGrantReceipt({ ...base("salary", "deferred_income"), bankHeadCode: "1110" });
    expect(r.map((l) => [l.accountCode, BigInt(l.debitMinor) > 0n ? "dr" : "cr"])).toEqual([["1110", "dr"], ["2320", "cr"]]);
    expect(buildGrantReceipt(base("general", "deferred_income"))[0]?.accountCode).toBe("1100");
    expect(buildRevenueRecognition(base("general", "deferred_income")).map((l) => [l.accountCode, BigInt(l.debitMinor) > 0n ? "dr" : "cr"])).toEqual([["2330", "dr"], ["4440", "cr"]]);
    expect(buildCapitalisation(base("capital", "deferred_income")).map((l) => [l.accountCode, BigInt(l.debitMinor) > 0n ? "dr" : "cr"])).toEqual([["2340", "dr"], ["2350", "cr"]]);
    expect(buildCapitalRelease(base("capital", "deferred_income")).map((l) => [l.accountCode, BigInt(l.debitMinor) > 0n ? "dr" : "cr"])).toEqual([["2350", "dr"], ["4450", "cr"]]);
  });
  it("capital_fund policy: receipt credits 3300 directly; capitalisation and release do not run (2340 / 2350 / 4450 stay idle)", async () => {
    expect(buildGrantReceipt(base("capital", "capital_fund")).map((l) => l.accountCode)).toEqual(["1100", "3300"]);
    expect(await codeOf(() => buildCapitalisation(base("capital", "capital_fund")))).toBe("GRANT_POLICY_NOT_APPLICABLE");
    expect(await codeOf(() => buildCapitalRelease(base("capital", "capital_fund")))).toBe("GRANT_POLICY_NOT_APPLICABLE");
    const all = [...buildGrantReceipt(base("capital", "capital_fund"))].map((l) => l.accountCode);
    for (const idle of [H.capitalReceipt, H.capitalDeferred, H.capitalRelease]) expect(all).not.toContain(idle);
  });
  it("capitalisation and release are for capital grants only", async () => {
    expect(await codeOf(() => buildCapitalisation(base("salary", "deferred_income")))).toBe("GRANT_CATEGORY");
    expect(await codeOf(() => buildCapitalRelease(base("general", "deferred_income")))).toBe("GRANT_CATEGORY");
  });
  it("toCapitalGrantPolicy: only the literal capital_fund flips it; anything else reads deferred_income", () => {
    expect(toCapitalGrantPolicy("capital_fund")).toBe("capital_fund");
    for (const v of [undefined, null, "", "deferred_income", "CAPITAL_FUND", 7]) expect(toCapitalGrantPolicy(v)).toBe("deferred_income");
  });
});

describe("NF-3 balancing (per fund)", () => {
  const cases: Array<[string, GrantCategory, CapitalGrantPolicy]> = [
    ["receipt", "salary", "deferred_income"], ["receipt", "capital", "deferred_income"], ["receipt", "capital", "capital_fund"],
    ["recognition", "general", "deferred_income"], ["capitalisation", "capital", "deferred_income"], ["release", "capital", "deferred_income"],
  ];
  it.each(cases)("%s (%s, %s): every line carries the grant's fund and the journal balances within it", (kind, category, policy) => {
    const lines = buildGrantJournal(kind as never, base(category, policy, 123456789012345678n));
    expect(lines.every((l) => l.fundId === F)).toBe(true);
    const total = lines.reduce((a, l) => a + BigInt(l.debitMinor) - BigInt(l.creditMinor), 0n);
    expect(total).toBe(0n);
    expect(() => assertFundsBalanced(lines.map((l) => ({ debitMinor: l.debitMinor, creditMinor: l.creditMinor, fund: l.fundId ?? null })))).not.toThrow();
  });
  it("the capital lifecycle nets out: after receipt, capitalise-all and release-all, 2340 is nil, 2350 nil, and 4450 carries the income", () => {
    const n = net([...buildGrantReceipt(base("capital", "deferred_income", 500n)), ...buildCapitalisation(base("capital", "deferred_income", 500n)), ...buildCapitalRelease(base("capital", "deferred_income", 500n))]);
    expect(n.get("2340")).toBe(0n);
    expect(n.get("2350")).toBe(0n);
    expect(n.get("4450")).toBe(-500n);
    expect(n.get("1100")).toBe(500n);
  });
  it("a non-positive amount is refused", async () => {
    expect(await codeOf(() => buildGrantReceipt(base("salary", "deferred_income", 0n)))).toBe("GRANT_AMOUNT");
    expect(await codeOf(() => buildRevenueRecognition(base("salary", "deferred_income", -5n)))).toBe("GRANT_AMOUNT");
  });
});

describe("NF-3 running-total headroom", () => {
  const T = (p: Partial<typeof ZERO_TOTALS>) => ({ ...ZERO_TOTALS, ...p });
  it("receipts cannot exceed the sanction", async () => {
    expect(await codeOf(() => assertHeadroom("receipt", "general", "deferred_income", T({ receipt: 900n }), 1000n, 101n))).toBe("GRANT_OVER_SANCTION");
    expect(await codeOf(() => assertHeadroom("receipt", "general", "deferred_income", T({ receipt: 900n }), 1000n, 100n))).toBe("NO_ERROR");
  });
  it("utilisation cannot exceed receipts; capitalisation cannot exceed receipts; release cannot exceed capitalised", async () => {
    expect(await codeOf(() => assertHeadroom("recognition", "salary", "deferred_income", T({ receipt: 500n, recognition: 400n }), 1000n, 101n))).toBe("GRANT_UTILISATION_EXCEEDS_RECEIPTS");
    expect(await codeOf(() => assertHeadroom("capitalisation", "capital", "deferred_income", T({ receipt: 500n, capitalisation: 500n }), 1000n, 1n))).toBe("GRANT_CAPITALISATION_EXCEEDS_RECEIPTS");
    expect(await codeOf(() => assertHeadroom("release", "capital", "deferred_income", T({ receipt: 500n, capitalisation: 300n, release: 300n }), 1000n, 1n))).toBe("GRANT_RELEASE_EXCEEDS_CAPITALISED");
    expect(await codeOf(() => assertHeadroom("release", "capital", "deferred_income", T({ receipt: 500n, capitalisation: 300n, release: 200n }), 1000n, 100n))).toBe("NO_ERROR");
  });
  it("capitalisation / release are refused under capital_fund, and for non-capital grants", async () => {
    expect(await codeOf(() => assertHeadroom("capitalisation", "capital", "capital_fund", T({ receipt: 5n }), 10n, 1n))).toBe("GRANT_POLICY_NOT_APPLICABLE");
    expect(await codeOf(() => assertHeadroom("release", "salary", "deferred_income", T({ receipt: 5n }), 10n, 1n))).toBe("GRANT_CATEGORY");
    expect(unspentMinor(T({ receipt: 900n, recognition: 250n }))).toBe(650n);
  });
});

describe("NF-3 policy read goes through loadPostingSettingsTx (no second settings mechanism)", () => {
  const makeTx = (r: unknown[]) => {
    const limit = vi.fn(async () => r);
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }));
    return { tx: { select }, select };
  };
  it("returns capitalGrantPolicy from the same single select; absent row / NULL read deferred_income", async () => {
    const a = makeTx([{ m: "off", f: true, g: "g", p: "capital_fund" }]);
    expect((await loadPostingSettingsTx(a.tx, "t")).capitalGrantPolicy).toBe("capital_fund");
    expect(a.select).toHaveBeenCalledTimes(1);
    expect((await loadPostingSettingsTx(makeTx([]).tx, "t")).capitalGrantPolicy).toBe("deferred_income");
    expect((await loadPostingSettingsTx(makeTx([{ m: "off", f: true, g: "g", p: null }]).tx, "t")).capitalGrantPolicy).toBe("deferred_income");
  });
  it("the grants module reads settings only through loadPostingSettingsTx and never selects gl.finance_settings itself", () => {
    const files = listTs(join(SRC, "modules/grants"));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) {
      const code = stripComments(read(f));
      expect(code, rel(f)).not.toMatch(/\.from\(\s*financeSettings\s*\)/);
      expect(code, rel(f)).not.toMatch(/FROM\s+gl\.finance_settings/i);
    }
    const svc = stripComments(read(join(SRC, "modules/grants/service.ts")));
    expect([...svc.matchAll(/\bloadPostingSettingsTx\(/g)].length).toBe(1);
  });
});

describe("NF-3 static guards: posting reuses the NF-1 path, writes no ledger itself, and the migration is shaped as specified", () => {
  it("grants service posts through fundContext + prepareFundPostingTx and publishes finance.gl.post; it writes no journal / ledger row", () => {
    const svc = stripComments(read(join(SRC, "modules/grants/service.ts")));
    expect(svc).toMatch(/\bfundContext\(tx, meta\.tenantId, ps\)/);
    expect(svc).toMatch(/\bprepareFundPostingTx\(tx, fx, meta\.tenantId,/);
    expect(svc).toMatch(/COMMANDS\.journalPost/);
    expect(svc).not.toMatch(/insertJournal|insertLedgerLine|insertJournalLine|financeLedger|financeJournals|INSERT\s+INTO\s+gl\.finance_/i);
    // the flag gate runs before any write
    expect(svc.indexOf("requireGrantsEnabledTx(tx, meta.tenantId)")).toBeGreaterThan(-1);
  });
  it("no file in modules/grants reads edition or the profile catalogue", () => {
    for (const f of listTs(join(SRC, "modules/grants"))) {
      const code = stripComments(read(f));
      expect(/\bedition\b/i.test(code) || /\b(getProfile|PROFILES|effectiveSettings)\b/.test(code), rel(f)).toBe(false);
    }
  });
  it("migration 0172 carries the specified shape", () => {
    const dir = join(SRC, "../migrations");
    const f = readdirSync(dir).filter((n) => n.startsWith("0172_"));
    expect(f).toEqual(["0172_finance_grants_register.sql"]);
    const sql = readFileSync(join(dir, f[0] as string), "utf8");
    expect(sql).toMatch(/capital_grant_policy text NOT NULL DEFAULT 'deferred_income'/);
    expect(sql).toMatch(/CHECK \(capital_grant_policy IN \('deferred_income', 'capital_fund'\)\)/);
    expect(sql).toMatch(/SET lock_timeout = '5s'/);
    for (const t of ["grants", "grant_postings", "grant_utilisation"]) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE gl\\.${t}\\s+FORCE ROW LEVEL SECURITY`));
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS gl\\.${t}\\b`));
    }
    expect(sql).toMatch(/FOREIGN KEY \(tenant_id, fund_id\) REFERENCES gl\.funds \(tenant_id, id\)/);
    expect(sql).toMatch(/category IN \('salary', 'general', 'capital'\)/);
    expect(sql).toMatch(/uc_form\s+text,/);                  // nullable, pluggable
    expect(sql).toMatch(/uc_submitted_date\s+date,/);
    expect(sql).toMatch(/interest_treatment\s+text,/);
    expect(sql).not.toMatch(/finance_major_heads/);          // the global major-head table is never touched
  });
});
