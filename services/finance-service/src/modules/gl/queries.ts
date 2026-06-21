import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { LedgerQueryParams } from "./validators.js";

export async function getLedger(tenantId: string, params: LedgerQueryParams) {
  return repo.getLedgerLines(tenantId, params.headId, params.from, params.to, params.limit);
}

export async function getTrialBalance(tenantId: string) {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "gl_trial_balance", tenantId),
    () => repo.getTrialBalance(tenantId),
    30
  );
}

export async function listJournalEntries(tenantId: string, limit: number) {
  const journals = await cache.getOrLoad(
    cache.makeKey(tenantId, "journals", `list:${limit}`),
    () => repo.listJournalsByTenant(tenantId, limit),
    60,
  );
  const entries = [];
  for (const journal of journals ?? []) {
    for (const line of journal.lines) {
      entries.push({
        id: `${journal.id}:${line.accountCode}`,
        voucherNo: journal.voucherNo,
        date: journal.postingDate,
        accountCode: line.accountCode,
        accountName: line.accountCode,
        debit: line.debitMinor / 100,
        credit: line.creditMinor / 100,
        referenceNo: journal.voucherNo,
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
