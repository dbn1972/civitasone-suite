import { cache } from "../../shared/infra.js";
import { fyDateBounds } from "../dashboard/queries.js";
import * as repo from "./repo.js";
import { headNatureOf } from "../../shared/head-nature.js";
import type { JournalLine } from "./schema.js";
import type { LedgerQueryParams } from "./validators.js";

function normalizeLine(raw: Record<string, unknown>): JournalLine {
  return {
    accountCode: String(raw.accountCode ?? raw.account ?? ""),
    debitMinor: String(raw.debitMinor ?? raw.debit ?? 0n),
    creditMinor: String(raw.creditMinor ?? raw.credit ?? 0n),
  };
}

export async function getLedger(tenantId: string, params: LedgerQueryParams) {
  let resolvedHeadId: string | undefined;
  if (params.headId) {
    const id = await repo.resolveHeadId(tenantId, params.headId);
    if (!id) return [];
    resolvedHeadId = id;
  }
  return repo.getLedgerLines(tenantId, resolvedHeadId, params.from, params.to, params.limit);
}

export async function getTrialBalance(tenantId: string) {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "gl_trial_balance", tenantId),
    () => repo.getTrialBalance(tenantId),
    30
  );
}

export async function getTrialBalanceBalanced(tenantId: string, period?: string) {
  const rows = await repo.getTrialBalanceByPeriod(tenantId, period);
  const periods = rows.map((r) => {
    const debit = r.totalDebit ?? 0n;
    const credit = r.totalCredit ?? 0n;
    return {
      period: r.period,
      totalDebitMinor: String(debit),
      totalCreditMinor: String(credit),
      differenceMinor: String(debit - credit),
      isBalanced: debit === credit,
    };
  });
  return {
    periods,
    isBalanced: periods.every((p) => p.isBalanced),
  };
}

export async function listJournalEntries(tenantId: string, limit: number, offset = 0) {
  const journals = await cache.getOrLoad(
    cache.makeKey(tenantId, "journals", `list:${limit}:${offset}`),
    () => repo.listJournalsByTenant(tenantId, limit, offset),
    60,
  );
  const entries = [];
  for (const journal of journals ?? []) {
    const lines = Array.isArray(journal.lines) ? journal.lines : [];
    for (const raw of lines) {
      const line = normalizeLine(raw as Record<string, unknown>);
      if (!line.accountCode) continue;
      entries.push({
        id: `${journal.id}:${line.accountCode}`,
        voucherNo: journal.voucherNo,
        date: journal.postingDate,
        accountCode: line.accountCode,
        accountName: line.accountCode,
        // Minor units (paise) as a bigint-safe decimal string — the frontend
        // passes these straight to formatMoney(), which expects minor units.
        // This previously did Number(line.debitMinor) / 100, i.e. converted
        // to rupees as a float; formatMoney() then re-interpreted that rupee
        // value as minor units, so every amount rendered 100x too small
        // (₹5,000.00 posted showed as ₹50.00) and large aggregates risked
        // float-precision loss on top of that.
        debit: line.debitMinor,
        credit: line.creditMinor,
        referenceNo: journal.voucherNo,
        type: journal.type as "payment" | "receipt" | "journal" | "budget",
      });
    }
  }
  return entries;
}

type StatementType = "asset" | "liability" | "income" | "expenditure";

/**
 * BUG FIX (accounting-critical #2): derive the Financial Statement type from
 * the account's REAL chart-of-accounts classification (budget.finance_heads),
 * not from array-index parity. Mirrors the code-prefix-first, classification-
 * as-tie-breaker approach already established in
 * financial-statements/routes.ts's natureOf() for the same reason: this
 * fleet's seeded COA mixes 'capital' (really assets, e.g. 1200/1250) and
 * 'revenue' (used for income), so classification alone mis-states the
 * statement. Collapsed to this schema's 4-way enum (no separate "equity"
 * bucket — folded into "liability"; "expense" renamed "expenditure" to match
 * FinancialStatementSummarySchema in packages/schemas/src/web.ts).
 */
export function deriveStatementType(code: string | null, classification: string | null): StatementType {
  // UAT P2 (A5): the hand-copied rule here had drifted from natureOf() (financial-statements/routes.ts): it typed a
  // 2xxx head explicitly classified as an expense (2202 General Education, the default bill head) as a liability.
  // Both now use the one shared rule; equity folds into "liability" and expense is "expenditure" in this schema.
  const nature = headNatureOf(code, classification?.toLowerCase() ?? null);
  if (nature === "expense") return "expenditure";
  if (nature === "equity") return "liability";
  return nature;
}

/** UAT P2 (J6, D4): a manual journal waiting for a checker, as the approval screen shows it. */
export type PendingJournalView = {
  id: string;
  voucherNo: string | null;
  type: string;
  postingDate: string;
  narration: string | null;
  totalMinor: string;
  lines: Array<{ accountCode: string; debitMinor: string; creditMinor: string; narration: string | null }>;
  createdBy: string;
  createdAt: string;
  /** True when the caller drafted it: the screen shows no Approve (approver must differ from maker). */
  isOwn: boolean;
  /** UAT P2 (J6): for a rejected journal, why, who decided and when; null while pending. */
  rejectionReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
};

export async function listPendingJournals(tenantId: string, actorId: string, limit: number, offset = 0): Promise<PendingJournalView[]> {
  return listJournalsInReview(tenantId, actorId, "pending_approval", limit, offset);
}

/** UAT P2 (J6): rejected manual journals (final, read-only), most recently rejected first. */
export async function listRejectedJournals(tenantId: string, actorId: string, limit: number, offset = 0): Promise<PendingJournalView[]> {
  return listJournalsInReview(tenantId, actorId, "rejected", limit, offset);
}

async function listJournalsInReview(
  tenantId: string, actorId: string, status: "pending_approval" | "rejected", limit: number, offset: number,
): Promise<PendingJournalView[]> {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "journals", `${status === "rejected" ? "rejected" : "pending"}:${limit}:${offset}`),
    () => repo.listJournalsInReview(tenantId, status, limit, offset),
    30,
  );
  return (rows ?? []).map((j) => {
    const lines = (Array.isArray(j.lines) ? j.lines : []).map((raw) => {
      const r = raw as Record<string, unknown>;
      const line = normalizeLine(r);
      return {
        accountCode: line.accountCode,
        debitMinor: String(line.debitMinor),
        creditMinor: String(line.creditMinor),
        narration: typeof r.narration === "string" && r.narration !== "" ? r.narration : null,
      };
    });
    const total = lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const voucherNo = String(j.voucherNo);
    return {
      id: j.id,
      // DRAFT-<id> is the placeholder a pending draft holds until the number is allocated on approval.
      voucherNo: voucherNo.startsWith("DRAFT-") ? null : voucherNo,
      type: j.type,
      postingDate: String(j.postingDate).slice(0, 10),
      narration: lines.find((l) => l.narration)?.narration ?? null,
      totalMinor: total.toString(),
      lines,
      createdBy: j.createdBy,
      // Through the cache a Date arrives as an ISO string.
      createdAt: new Date(j.createdAt as unknown as string).toISOString(),
      isOwn: j.createdBy === actorId,
      rejectionReason: j.status === "rejected" ? (j.rejectionReason ?? null) : null,
      decidedBy: j.status === "rejected" ? j.updatedBy : null,
      decidedAt: j.status === "rejected" ? new Date(j.updatedAt as unknown as string).toISOString() : null,
    };
  });
}

export async function listFinancialStatements(tenantId: string) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "gl_financial_statements", tenantId),
    () => repo.getTrialBalanceWithClassification(tenantId),
    30,
  ) ?? [];
  // GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-03: amounts leave as exact
  // minor-unit (paise) decimal strings, straight from the bigint sums. They
  // used to be Number(bigint) / 100 rupee floats, which lose precision above
  // 2^53 paise and made the web guess the unit. Opening is 0 because this is a
  // cumulative, all-periods trial balance.
  //
  // The rows come back through the cache (JSON), where a bigint is a string
  // (shared/bigint-json.ts), so normalise with BigInt() before doing any
  // arithmetic: subtracting two strings would silently go through double maths.
  return rows.map((row) => {
    const credit = BigInt(row.totalCredit);
    const debit = BigInt(row.totalDebit);
    return {
      id: row.headId,
      head: row.headId,
      openingBalance: "0",
      receipts: credit.toString(),
      payments: debit.toString(),
      closingBalance: (credit - debit).toString(),
      type: deriveStatementType(row.code, row.classification),
    };
  });
}

/**
 * Server-paged General Ledger lines (GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-03). Same line shape as
 * listJournalEntries so the web table renders either; adds filters and whole-set totals.
 */
export async function pageGeneralLedger(
  tenantId: string,
  p: { fy?: string | undefined; type?: string | undefined; q?: string | undefined; limit: number; offset: number },
) {
  const bounds = p.fy ? fyDateBounds(p.fy) : null;
  const { rows, totals, ledgerTotals } = await repo.pageJournalLines({
    tenantId, from: bounds?.start, to: bounds?.end, type: p.type, q: p.q, limit: p.limit, offset: p.offset,
  });
  return {
    data: rows.map((r) => ({
      id: `${r.journal_id}:${r.account_code}`,
      voucherNo: r.voucher_no,
      date: r.posting_date,
      accountCode: r.account_code,
      accountName: r.account_code,
      ...(r.narration ? { narration: r.narration } : {}),
      debit: r.debit,
      credit: r.credit,
      referenceNo: r.voucher_no,
      type: r.type as "payment" | "receipt" | "journal" | "budget",
    })),
    pagination: { limit: p.limit, offset: p.offset, total: totals.entryLines, hasMore: p.offset + rows.length < totals.entryLines },
    // `totals` covers the FILTERED set (fiscal year + type tab + search); `ledgerTotals` is the same fiscal year with no
    // tab/search, the only figure a debit = credit balance check is meaningful on (a single account's lines never balance).
    totals,
    ledgerTotals,
  };
}
