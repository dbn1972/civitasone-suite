/**
 * F89/F91 (UAT T6-01, T6-03): the standard GL heads seeded at provisioning and backfilled into existing tenants must
 * cover EVERY account code a posting path resolves by code, and each seeded head must have the NATURE its posting
 * paths use it for (income vs expense, asset vs liability) -- e.g. citizen fees must not be credited to an expense head.
 *
 * Default codes are found in source, in all three forms the producers use:
 *   process.env.X ?? "1234"          process.env.X?.trim() || "1234"
 *   const v = process.env.X?.trim(); return v ? v : "1234";       and literal   accountCode: "1234"
 * A producer that adds a default code without a standard head, or an env var whose use has not been declared below,
 * fails here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { standardGlHeads, missingStandardHeads, BILL_HEAD_HOA } from "../src/modules/gl/standard-heads.js";
import { natureOf } from "../src/modules/financial-statements/routes.js";
import { parseHoA } from "../src/shared/hoa.js";

type Nature = "asset" | "liability" | "income" | "expense";

// finance-service modules that build journals / bills from account CODES (resolved per tenant in budget.finance_heads
// by budgetRepo.findHeadByCodeTx). simplified/ is excluded: it posts to its own MSME chart (a separate table).
const POSTING_MODULES = ["gl", "revenue-billing", "revenue-gl", "payments", "treasury", "tds", "integrations", "fixed-asset", "subledger"];
const SERVICES = join(__dirname, "..", "..");
const MODULES = join(__dirname, "..", "src", "modules");
// producers in other services that send a finance head CODE (e.g. a works bill's headCode)
const EXTERNAL_PRODUCERS = ["works-service/src/modules/billing/consumer.ts"];

/** How each env-configured code is USED by its posting path (the side of the journal it sits on). */
const ENV_USE: Record<string, Nature> = {
  FINANCE_BANK_CODE: "asset", FINANCE_CASH_CODE: "asset", FINANCE_REVENUE_CASH_CODE: "asset", FINANCE_BILLING_CASH_CODE: "asset",
  PAYROLL_GL_BANK_HEAD: "asset", FINANCE_FIXED_ASSET_CODE: "asset", FINANCE_ACCUM_DEP_CODE: "asset" /* contra-asset */,
  FINANCE_BILLING_RECEIVABLE_CODE: "asset", FINANCE_AR_CONTROL_CODE: "asset",
  FINANCE_AP_CONTROL_CODE: "liability", FINANCE_DEPOSIT_LIABILITY_CODE: "liability", PAYROLL_GL_NET_PAYABLE_HEAD: "liability",
  FINANCE_TDS_PAYABLE_CODE: "liability",
  FINANCE_REVENUE_INCOME_CODE: "income", FINANCE_BILLING_REVENUE_CODE: "income", FINANCE_CITIZEN_REVENUE_CODE: "income",
  FINANCE_FORFEIT_INCOME_CODE: "income", FINANCE_REVENUE_REFUND_CODE: "income" /* contra-revenue */,
  FINANCE_GAIN_LOSS_CODE: "expense", FINANCE_DEP_EXPENSE_CODE: "expense", FINANCE_STAT_DEP_EXPENSE_CODE: "expense",
  FINANCE_IMPAIRMENT_CODE: "expense", FINANCE_TDS_EXPENSE_CODE: "expense",
  FINANCE_GRN_BILL_HEAD_CODE: "expense", WORKS_FINANCE_BILL_HEAD_CODE: "expense",
};
/** Literal `accountCode: "1234"` legs (payroll accrual, integrations/consumer.ts). */
const LITERAL_USE: Record<string, Nature> = { "5001": "expense", "5002": "expense", "2101": "liability", "2102": "liability", "2103": "liability" };

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

type Use = { code: string; use: Nature | undefined; source: string };

function scan(text: string, file: string): Use[] {
  const out: Use[] = [];
  const env = (name: string, code: string) => out.push({ code, use: ENV_USE[name], source: `${name} (${file})` });
  for (const m of text.matchAll(/process\.env(?:\.([A-Z_]+)|\[\s*["']([A-Z_]+)["']\s*\])\s*\?\?\s*["'](\d{4})["']/g)) env(m[1] ?? m[2]!, m[3]!);
  for (const m of text.matchAll(/process\.env(?:\.([A-Z_]+)|\[\s*["']([A-Z_]+)["']\s*\])\?\.trim\(\)\s*\|\|\s*["'](\d{4})["']/g)) env(m[1] ?? m[2]!, m[3]!);
  // const v = process.env.X?.trim(); return v ? v : "1234";
  for (const m of text.matchAll(/const\s+(\w+)\s*=\s*process\.env\.([A-Z_]+)\?\.trim\(\);[\s\S]{0,200}?\1\s*\?\s*\1\s*:\s*["'](\d{4})["']/g)) env(m[2]!, m[3]!);
  for (const m of text.matchAll(/accountCode:\s*["'](\d{4})["']/g)) out.push({ code: m[1]!, use: LITERAL_USE[m[1]!], source: `literal ${m[1]} (${file})` });
  return out;
}

function defaultUses(): Use[] {
  const files = [
    ...POSTING_MODULES.flatMap((mod) => sources(join(MODULES, mod))),
    ...EXTERNAL_PRODUCERS.map((f) => join(SERVICES, f)),
  ];
  return files.flatMap((f) => scan(readFileSync(f, "utf8"), f.replace(SERVICES, "")));
}

/** The nature the seeded head has: by its classification, and as the financial statements read it. */
const CLASS_NATURE: Record<string, Nature> = { asset: "asset", capital: "asset", liability: "liability", income: "income", expense: "expense" };

describe("standard GL heads", () => {
  it("cover the codes UAT tenant A was missing (T6-01 / T6-03) and the bill head", () => {
    const codes = standardGlHeads().map((h) => h.code);
    for (const c of ["1250", "5100", "5101", "1300", "4010", "4001", "4090", "4100", "4200", "5200", "2202"]) expect(codes).toContain(c);
  });

  it("the scan understands every default form (??, ?.trim() ||, ?.trim() then ternary)", () => {
    const sample = [
      'const A = process.env.FINANCE_BANK_CODE ?? "1100";',
      'const B = process.env.FINANCE_GRN_BILL_HEAD_CODE?.trim() || "2202";',
      'function f() { const configured = process.env.WORKS_FINANCE_BILL_HEAD_CODE?.trim();\n  return configured ? configured : "2202"; }',
      '{ accountCode: "5001", debitMinor: 1n }',
    ].join("\n");
    expect(scan(sample, "x").map((u) => u.code)).toEqual(["1100", "2202", "2202", "5001"]);
  });

  it("cover every default account code a posting path resolves by code", () => {
    const codes = new Set(standardGlHeads().map((h) => h.code));
    const uses = defaultUses();
    expect(uses.length).toBeGreaterThan(25); // the scan really saw the posting modules
    expect(uses.filter((u) => !codes.has(u.code)).map((u) => u.source)).toEqual([]);
  });

  it("every scanned code has a declared use, and the seeded head has that nature (classification AND statements)", () => {
    const byCode = new Map(standardGlHeads().map((h) => [h.code, h]));
    const problems: string[] = [];
    for (const u of defaultUses()) {
      if (!u.use) { problems.push(`${u.source}: use not declared in ENV_USE / LITERAL_USE`); continue; }
      const h = byCode.get(u.code);
      if (!h) continue; // reported by the coverage test
      const cls = CLASS_NATURE[h.classification];
      const stmt = natureOf(h.code, h.classification);
      if (cls !== u.use) problems.push(`${u.source}: used as ${u.use}, seeded as ${h.classification}`);
      if (stmt !== u.use) problems.push(`${u.source}: used as ${u.use}, statements read ${h.code} as ${stmt}`);
    }
    expect(problems).toEqual([]);
  });

  it("have one definition per code, a name and a known classification; 2050 is a control account", () => {
    const heads = standardGlHeads();
    expect(new Set(heads.map((h) => h.code)).size).toBe(heads.length);
    for (const h of heads) {
      expect(h.name.length).toBeGreaterThan(3);
      expect(Object.keys(CLASS_NATURE)).toContain(h.classification);
    }
    expect(heads.find((h) => h.code === "2050")?.isControl).toBe(true);
  });

  it("the bill head 2202 carries a valid 18-digit HoA on major head 2202", () => {
    const h = standardGlHeads().find((x) => x.code === "2202")!;
    expect(h.hoaCode).toBe(BILL_HEAD_HOA);
    expect(parseHoA(h.hoaCode).majorHead).toBe("2202");
  });

  it("missingStandardHeads plans only the codes a tenant lacks", () => {
    const all = standardGlHeads().map((h) => h.code);
    expect(missingStandardHeads(all)).toEqual([]);
    expect(missingStandardHeads(all.filter((c) => c !== "1250")).map((h) => h.code)).toEqual(["1250"]);
  });
});
