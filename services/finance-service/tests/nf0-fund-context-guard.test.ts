/**
 * Section 8 NF-0 call-site guard (docs/design/SECTION8-NONPROFIT-FINANCE.md §0 contract #4, §10 NF-0).
 *
 * Static, no DB. Asserts that EVERY place in finance-service/src that writes a journal, journal line or ledger line
 * (a) routes the row through the `fundContext()` seam, or (b) is on the explicit allow-list below with a stated reason.
 * This is the guard that protects NF-1: a new writer that bypasses the seam fails here, so no ledger line can ever be
 * written without a fund decision.
 *
 * Writers detected: the gl/repo.ts functions (insertJournal / insertLedgerLine / insertJournalLine), direct drizzle
 * `.insert(financeLedger | financeJournals | financeJournalLines)`, and raw `INSERT INTO gl.finance_<ledger|journals|
 * journal_lines|cash_book|opening_balances>`.
 */
import { describe, expect, it } from "vitest";
import { SRC, listTs, read, rel, stripComments } from "./_nf0-static.js";

const REPO_CALL = /\b(insertJournalLine|insertLedgerLine|insertJournal)\(/g;
const DRIZZLE_INSERT = /\.insert\(\s*(?:\w+\.)?(financeLedger|financeJournals|financeJournalLines)\b/g;
const RAW_INSERT = /INSERT\s+INTO\s+gl\.(finance_ledger|finance_journals|finance_journal_lines|finance_cash_book|finance_opening_balances)\b/gi;
/** The routed shape: repo.insertX(tx, <ctx>.tagX(  -- the row is built inside the tag call. */
const ROUTED: Record<string, RegExp> = {
  insertJournal: /\binsertJournal\(\s*\w+\s*,\s*\w+\.tagJournal\(/,
  insertLedgerLine: /\binsertLedgerLine\(\s*\w+\s*,\s*\w+\.tagLedgerLine\(/,
  insertJournalLine: /\binsertJournalLine\(\s*\w+\s*,\s*\w+\.tagJournalLine\(/,
};

/**
 * Files that write ledger-ish rows WITHOUT the seam, and why. Every entry must still contain a writer (stale entries
 * fail), so this list can only shrink or be consciously extended with a reason in review.
 */
const ALLOW: Record<string, string> = {
  "modules/gl/repo.ts": "the writer DEFINITIONS (insertJournal/insertLedgerLine/insertJournalLine); callers are checked below",
  "modules/simplified/consumer.ts":
    "MSME simplified chart-of-accounts journals (placeholder head ids, no ledger row, no budget heads); not the nonprofit/govt posting path -- NF-1 must decide explicitly whether a simplified tenant can be fund-accounted (expected: no)",
  "modules/cashbook/consumer.ts": "cash book entry (not a ledger line); NF-1 adds the nullable fund_id + head tag here per design 2.3 and then routes it via fundContext()",
  "shared/cashbook.ts": "cash book running-balance writer (not a ledger line); NF-1 routes it via fundContext() per design 2.3",
  "modules/year-end/repo.ts": "gl.finance_opening_balances rollover writer (not a ledger line); NF-1 adds the per-fund fundYearEndRollover per design 2.3",
};

type Hit = { file: string; kind: string; name: string };

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

describe("NF-0 call-site guard: every ledger/journal write goes through fundContext()", () => {
  const { hits, sources } = scan();
  const files = [...new Set(hits.map((h) => h.file))];

  it("finds the known posting writers (the scan itself works)", () => {
    expect(files).toContain("modules/gl/consumer.ts");
    expect(files).toContain("modules/gl/repo.ts");
    expect(hits.filter((h) => h.file === "modules/gl/consumer.ts" && h.kind === "repo").length).toBeGreaterThanOrEqual(4);
  });

  it("every writer file is either routed through the seam or on the allow-list", () => {
    const offenders = files.filter((f) => !(f in ALLOW) && !/\bfundContext\(/.test(sources.get(f) as string));
    expect(offenders, `writers that bypass fundContext() and are not allow-listed: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no allow-list entry is stale (each still contains a writer) and each states a reason", () => {
    for (const [f, why] of Object.entries(ALLOW)) {
      expect(files, `stale allow-list entry ${f}`).toContain(f);
      expect(why.length, f).toBeGreaterThan(20);
    }
  });

  it("in routed files, every repo writer call passes its row through the matching ctx.tag*() call", () => {
    for (const f of files.filter((x) => !(x in ALLOW))) {
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

  it("consumer.ts resolves fundContext() before its writers (once per posting, in both journal paths)", () => {
    const code = sources.get("modules/gl/consumer.ts") as string;
    const ctxCalls = [...code.matchAll(/\bfundContext\(/g)].map((m) => m.index as number);
    expect(ctxCalls.length).toBeGreaterThanOrEqual(2); // postJournal + the manual-draft consumer
    const firstWrite = Math.min(...[...code.matchAll(REPO_CALL)].map((m) => m.index as number));
    expect(Math.min(...ctxCalls)).toBeLessThan(firstWrite);
    // the draft consumer's insertJournal (the last one in the file) is preceded by its own fundContext()
    const lastInsertJournal = code.lastIndexOf("insertJournal(");
    expect(Math.max(...ctxCalls)).toBeLessThan(lastInsertJournal);
    expect(Math.max(...ctxCalls)).toBeGreaterThan(code.indexOf("insertJournalLine("));
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
