/**
 * Section 8 call-site guard (NF-0, hardened in NF-1 per the NF-0 review S1/S2).
 * Design: docs/design/SECTION8-NONPROFIT-FINANCE.md §0 contract #4, §10 NF-0.
 *
 * Static, no DB. Asserts that EVERY place in finance-service/src that writes a journal, journal line, ledger line, opening
 * balance or cash-book row
 *   (a) routes the row through the `fundContext()` seam, or
 *   (b) is on an explicit allow-list with a stated reason AND an exact writer COUNT (a new writer added to an allow-listed
 *       file changes the count and fails here, so an allow-list entry can never silently grow).
 * This is the guard that protects the fund dimension: a new writer that bypasses the seam fails here, so no ledger line can
 * ever be written without a fund decision.
 *
 * Writers detected (comments stripped):
 *  - the gl/repo.ts functions insertJournal / insertLedgerLine / insertJournalLine;
 *  - direct drizzle `.insert(financeLedger | financeJournals | financeJournalLines | openingBalances | financeOpeningBalances |
 *    financeCashBook)`;
 *  - raw SQL `INSERT INTO gl.finance_<ledger|journals|journal_lines|cash_book|opening_balances>`, tolerant of any whitespace /
 *    newlines around the dot and of "double", 'single' or `back` quotes around the schema and table names.
 */
import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { SRC, listTs, read, rel, stripComments } from "./_nf0-static.js";

const REPO_CALL = /\b(insertJournalLine|insertLedgerLine|insertJournal)\(/g;
const DRIZZLE_INSERT = /\.insert\(\s*(?:\w+\.)?(financeLedger|financeJournals|financeJournalLines|openingBalances|financeOpeningBalances|financeCashBook)\b/g;
const RAW_INSERT = /INSERT\s+INTO\s+["'`]?gl["'`]?\s*\.\s*["'`]?(finance_ledger|finance_journals|finance_journal_lines|finance_cash_book|finance_opening_balances)["'`]?(?![\w])/gi;
/** The routed shape: repo.insertX(tx, <ctx>.tagX(  -- the row is built inside the tag call (extra args after the row are fine). */
const ROUTED: Record<string, RegExp> = {
  insertJournal: /\binsertJournal\(\s*\w+\s*,\s*\w+\.tagJournal\(/,
  insertLedgerLine: /\binsertLedgerLine\(\s*\w+\s*,\s*\w+\.tagLedgerLine\(/,
  insertJournalLine: /\binsertJournalLine\(\s*\w+\s*,\s*\w+\.tagJournalLine\(/,
};

type Entry = { why: string; count: number; mustContain?: RegExp };

/**
 * Files that write ledger-ish rows WITHOUT passing the row through ctx.tag*(), and why. `count` is the EXACT number of writer
 * hits (repo calls + drizzle inserts + raw inserts) in the file. Every entry must still contain a writer (stale entries fail).
 */
const ALLOW: Record<string, Entry> = {
  "modules/gl/repo.ts": {
    why: "the writer DEFINITIONS (insertJournal / insertLedgerLine / insertJournalLine each wrap one drizzle insert); the callers are checked below",
    count: 3,
  },
  "modules/simplified/consumer.ts": {
    why: "MSME simplified chart journals (placeholder head ids, no ledger row, no budget heads) cannot carry a fund; assertFundAccountingOffTx() REFUSES to post while fund accounting is on (FUND_UNSUPPORTED_WRITER), so no untagged journal reaches a fund-accounted tenant",
    count: 2,
    mustContain: /\bassertFundAccountingOffTx\(/,
  },
  "modules/cashbook/consumer.ts": {
    why: "cash-book entry (not a ledger line); fund_id is tagged by the BEFORE INSERT trigger gl.tag_fund_id (migration 0171: OFF -> NULL, ON -> GENERAL, ON without GENERAL -> refused)",
    count: 1,
  },
  "shared/cashbook.ts": {
    why: "cash-book running-balance writer (not a ledger line); fund_id is tagged by the BEFORE INSERT trigger gl.tag_fund_id (migration 0171); head_id is written only when the caller passes one",
    count: 1,
  },
  "modules/year-end/repo.ts": {
    why: "the GOVT year-end opening-balance rollover (left untouched by design 2.2); applyYearEndClose selects year-end/fund-repo.ts instead when fund accounting is on",
    count: 1,
    mustContain: /\bfundYearEndRollover\(/,
  },
  "modules/approvals/apply.ts": {
    why: "applyOpeningBalances (go-live opening balances entered by an officer): a drizzle insert of finance_opening_balances; fund_id is written only for an entry that names a fund and is otherwise tagged by the BEFORE INSERT trigger gl.tag_fund_id (migration 0171)",
    count: 1,
  },
};

/** Writers that are NOT repo calls but still go through the seam: the file must call fundContext() and use the matching ctx.tag*(). */
const DIRECT_ROUTED: Record<string, { why: string; count: number; tag: RegExp }> = {
  "modules/year-end/fund-repo.ts": {
    why: "per-fund year-end rollover: raw INSERT into finance_opening_balances whose fund_id comes from fx.tagOpeningBalance()",
    count: 1,
    tag: /\.tagOpeningBalance\(/,
  },
};

type Hit = { file: string; kind: "repo" | "drizzle" | "raw"; name: string };

function scan() {
  const hits: Hit[] = [];
  const sources = new Map<string, string>();
  for (const f of listTs(SRC)) {
    const code = stripComments(read(f));
    sources.set(rel(f), code);
    for (const m of code.matchAll(REPO_CALL)) {
      // skip the definition site `export async function insertX(`
      const before = code.slice(Math.max(0, (m.index ?? 0) - 30), m.index);
      if (/function\s+$/.test(before)) continue;
      hits.push({ file: rel(f), kind: "repo", name: m[1] as string });
    }
    for (const m of code.matchAll(DRIZZLE_INSERT)) hits.push({ file: rel(f), kind: "drizzle", name: m[1] as string });
    for (const m of code.matchAll(RAW_INSERT)) hits.push({ file: rel(f), kind: "raw", name: m[1] as string });
  }
  return { hits, sources };
}

describe("call-site guard: every ledger/journal/opening-balance/cash-book write goes through fundContext() or is pinned", () => {
  const { hits, sources } = scan();
  const files = [...new Set(hits.map((h) => h.file))];
  const countOf = (f: string) => hits.filter((h) => h.file === f).length;

  it("finds the known posting writers (the scan itself works)", () => {
    expect(files).toContain("modules/gl/consumer.ts");
    expect(files).toContain("modules/gl/repo.ts");
    expect(hits.filter((h) => h.file === "modules/gl/consumer.ts" && h.kind === "repo").length).toBeGreaterThanOrEqual(4);
  });

  it("the detectors catch drizzle opening-balance / cash-book inserts and quoted, spaced, multi-line raw SQL (S1/S2)", () => {
    const sample = (s: string, re: RegExp) => [...s.matchAll(new RegExp(re.source, re.flags))].length;
    expect(sample("await tx.insert(openingBalances).values(x)", DRIZZLE_INSERT)).toBe(1);
    expect(sample("await tx.insert(schema.financeCashBook).values(x)", DRIZZLE_INSERT)).toBe(1);
    expect(sample('INSERT INTO "gl"."finance_ledger" (a)', RAW_INSERT)).toBe(1);
    expect(sample("insert   into\n   gl . finance_cash_book (a)", RAW_INSERT)).toBe(1);
    expect(sample("INSERT INTO `gl`.`finance_opening_balances`", RAW_INSERT)).toBe(1);
    expect(sample("INSERT INTO gl.finance_ledger_archive (a)", RAW_INSERT)).toBe(0); // a different table is not a hit
  });

  it("every writer file is routed through the seam, or on the allow-list, or on the direct-routed list", () => {
    const offenders = files.filter((f) => !(f in ALLOW) && !(f in DIRECT_ROUTED) && !/\bfundContext\(/.test(sources.get(f) as string));
    expect(offenders, `writers that bypass fundContext() and are not allow-listed: ${offenders.join(", ")}`).toEqual([]);
  });

  it("each allow-list entry is not stale, states a reason, is count-pinned, and keeps its safeguard", () => {
    for (const [f, e] of Object.entries(ALLOW)) {
      expect(files, `stale allow-list entry ${f}`).toContain(f);
      expect(e.why.length, f).toBeGreaterThan(40);
      expect(countOf(f), `${f}: expected exactly ${e.count} writer(s) -- a new writer in an allow-listed file must be routed or consciously re-pinned`).toBe(e.count);
      if (e.mustContain) expect(sources.get(f), `${f} lost its safeguard ${e.mustContain}`).toMatch(e.mustContain);
    }
  });

  it("each direct-routed entry calls fundContext(), uses its ctx.tag*(), and is count-pinned", () => {
    for (const [f, e] of Object.entries(DIRECT_ROUTED)) {
      expect(files, `stale direct-routed entry ${f}`).toContain(f);
      expect(sources.get(f), f).toMatch(/\bfundContext\(/);
      expect(sources.get(f), f).toMatch(e.tag);
      expect(countOf(f), `${f}: expected exactly ${e.count} writer(s)`).toBe(e.count);
    }
  });

  it("in routed files, every repo writer call passes its row through the matching ctx.tag*() call; no direct insert hides there", () => {
    for (const f of files.filter((x) => !(x in ALLOW) && !(x in DIRECT_ROUTED))) {
      const code = sources.get(f) as string;
      for (const h of hits.filter((x) => x.file === f)) {
        expect(h.kind, `${f}: direct ${h.kind} insert of ${h.name} bypasses repo/fundContext`).toBe("repo");
        const re = ROUTED[h.name] as RegExp;
        const all = [...code.matchAll(new RegExp(`\\b${h.name}\\(`, "g"))].length;
        const routed = [...code.matchAll(new RegExp(re.source, "g"))].length;
        expect(routed, `${f}: ${h.name} called ${all}x but only ${routed}x via tag*()`).toBe(all);
      }
    }
  });

  it("consumer.ts resolves fundContext() before its writers (once per posting, in both journal paths) and tags each line from ONE source", () => {
    const code = sources.get("modules/gl/consumer.ts") as string;
    const ctxCalls = [...code.matchAll(/\bfundContext\(/g)].map((m) => m.index as number);
    expect(ctxCalls.length).toBeGreaterThanOrEqual(2); // postJournal + the manual-draft consumer
    const firstWrite = Math.min(...[...code.matchAll(REPO_CALL)].map((m) => m.index as number));
    expect(Math.min(...ctxCalls)).toBeLessThan(firstWrite);
    const lastInsertJournal = code.lastIndexOf("insertJournal(");
    expect(Math.max(...ctxCalls)).toBeLessThan(lastInsertJournal);
    expect(Math.max(...ctxCalls)).toBeGreaterThan(code.indexOf("insertJournalLine("));
    // the ledger line and the journal-line row take the SAME `lineFund`, so the two (and the JSONB element) cannot drift
    expect(code).toMatch(/const lineFund = fx\.fundOfLine\(line\)/);
    expect(code).toMatch(/tagLedgerLine\([\s\S]*?\},\s*lineFund\)\)/);
    expect(code).toMatch(/tagJournalLine\([\s\S]*?\},\s*lineFund\)\)/);
    // the fund checks run before the first write
    expect(code.indexOf("prepareFundPostingTx(")).toBeLessThan(firstWrite);
  });

  it("the settings row is read once per posting: postJournal loads it once and hands it to the budget check AND the fund seam (S4)", () => {
    const code = sources.get("modules/gl/consumer.ts") as string;
    expect([...code.matchAll(/\bloadPostingSettingsTx\(/g)].length).toBe(1);
    expect(code).toMatch(/loadBudgetControlTx\(tx, journal\.tenantId, postingSettings\)/);
    expect(code).toMatch(/fundContext\(tx, journal\.tenantId, postingSettings\)/);
  });

  it("the migration that tags opening-balance and cash-book rows by trigger exists (the allow-list reasons rely on it)", () => {
    const migrations = resolve(SRC, "../migrations");
    const f = readdirSync(migrations).find((n) => n.startsWith("0171_"));
    expect(f).toBeTruthy();
    const sql = read(join(migrations, f as string));
    expect(sql).toMatch(/CREATE TRIGGER trg_opening_balances_fund BEFORE INSERT ON gl\.finance_opening_balances/);
    expect(sql).toMatch(/CREATE TRIGGER trg_cash_book_fund BEFORE INSERT ON gl\.finance_cash_book/);
  });

  it("the status-only finalize UPDATE (markPendingJournalPosted) writes no ledger/line data", () => {
    // Allowed to bypass the seam: it only flips status/voucher_no on an already-inserted draft. Pin that it stays so.
    const repo = sources.get("modules/gl/repo.ts") as string;
    const body = repo.slice(repo.indexOf("function markPendingJournalPosted"));
    const end = body.indexOf("\nexport ");
    const fn = end === -1 ? body : body.slice(0, end);
    expect(fn).not.toMatch(/lines|ledger|journal_lines|fund/i);
  });
});
