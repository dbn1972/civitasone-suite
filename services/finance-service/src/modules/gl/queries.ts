import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { JournalLine } from "./schema.js";
import type { LedgerQueryParams } from "./validators.js";

function normalizeLine(raw: Record<string, unknown>): JournalLine {
  return {
    accountCode: String(raw.accountCode ?? raw.account ?? ""),
    debitMinor: Number(raw.debitMinor ?? raw.debit ?? 0),
    creditMinor: Number(raw.creditMinor ?? raw.credit ?? 0),
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
      totalDebitMinor: Number(debit),
      totalCreditMinor: Number(credit),
      differenceMinor: Number(debit - credit),
      isBalanced: debit === credit,
    };
  });
  return {
    periods,
    isBalanced: periods.every((p) => p.isBalanced),
  };
}

export async function listJournalEntries(tenantId: string, limit: number) {
  const journals = await cache.getOrLoad(
    cache.makeKey(tenantId, "journals", `list:${limit}`),
    () => repo.listJournalsByTenant(tenantId, limit),
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
        debit: line.debitMinor / 100,
        credit: line.creditMinor / 100,
        referenceNo: journal.voucherNo,
        type: journal.type as "payment" | "receipt" | "journal" | "budget",
      });
    }
  }
  return entries;
}

export async function listFinancialStatements(tenantId: string) {
  const rows = (await getTrialBalance(tenantId)) ?? [];
  return rows.map((row, idx) => ({
    id: row.headId,
    head: row.headId,
    openingBalance: 0,
    receipts: Number(row.totalCredit) / 100,
    payments: Number(row.totalDebit) / 100,
    closingBalance: Number(row.totalCredit - row.totalDebit) / 100,
    type: (idx % 2 === 0 ? "asset" : "expenditure") as "asset" | "liability" | "income" | "expenditure",
  }));
}
