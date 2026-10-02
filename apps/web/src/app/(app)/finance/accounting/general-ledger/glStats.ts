/**
 * GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-01: ledger headline figures, derived
 * from the SAME rows the table renders (so stat cards and table can never
 * disagree on provenance). Pure + BigInt paise (no float addition).
 */
export interface GlStatEntry {
  /** "<journalId>:<line>" (or a bare journal id) -- see journalIdOf. */
  id: string;
  accountCode: string;
  debit: string;
  credit: string;
}

export interface GlStats {
  /** Distinct vouchers (journals) -- NOT rows: a 3-line voucher counts once. */
  vouchers: number;
  /** Ledger lines (what the table's rows are). */
  entryLines: number;
  accountsActive: number;
  totalDebit: bigint;
  totalCredit: bigint;
  /** null when there are no entries: an empty ledger is "no entries", never "balanced". */
  balance: "balanced" | "unbalanced" | null;
}

/** Rows are journal lines with id "journalId:line"; the voucher is the journal. */
export function journalIdOf(id: string): string {
  const i = id.indexOf(":");
  return i === -1 ? id : id.slice(0, i);
}

export function computeGlStats(entries: readonly GlStatEntry[]): GlStats {
  let totalDebit = 0n;
  let totalCredit = 0n;
  for (const e of entries) {
    totalDebit += BigInt(e.debit || "0");
    totalCredit += BigInt(e.credit || "0");
  }
  return {
    vouchers: new Set(entries.map((e) => journalIdOf(e.id))).size,
    entryLines: entries.length,
    accountsActive: new Set(entries.map((e) => e.accountCode)).size,
    totalDebit,
    totalCredit,
    balance: entries.length === 0 ? null : totalDebit === totalCredit ? "balanced" : "unbalanced",
  };
}
