import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
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
function deriveStatementType(code: string | null, classification: string | null): StatementType {
  const d = code?.charAt(0) ?? "";
  if (d === "1") return "asset";
  if (d === "4" && (classification === "income" || classification === "revenue")) return "income";
  if (d === "5" || d === "6") return "expenditure";
  // REVIEW FOLLOW-UP: natureOf() (financial-statements/routes.ts) special-cases
  // 4200 (gain/loss on disposal, GAIN_LOSS in gl/consumer.ts) as expense before
  // its generic "4" -> income fallback; this dropped that special case, so
  // 4200 would misclassify as income. Reconciled to match.
  if (code === "4200") return "expenditure";
  if (d === "4") return "income";
  if (d === "2" || d === "3") return "liability";
  // No usable code prefix (e.g. an orphaned ledger row) — fall back to the
  // stored classification directly.
  const c = (classification ?? "").toLowerCase();
  if (c === "asset") return "asset";
  if (c === "income" || c === "revenue") return "income";
  if (c === "expense" || c === "expenditure") return "expenditure";
  return "liability";
}

export async function listFinancialStatements(tenantId: string) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "gl_financial_statements", tenantId),
    () => repo.getTrialBalanceWithClassification(tenantId),
    30,
  ) ?? [];
  return rows.map((row) => ({
    id: row.headId,
    head: row.headId,
    openingBalance: 0,
    receipts: Number(row.totalCredit) / 100,
    payments: Number(row.totalDebit) / 100,
    closingBalance: Number(row.totalCredit - row.totalDebit) / 100,
    type: deriveStatementType(row.code, row.classification),
  }));
}
