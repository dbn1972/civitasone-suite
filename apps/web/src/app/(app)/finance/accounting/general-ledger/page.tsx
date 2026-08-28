import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getFinanceGLEntries } from "../../../../_data/loaders";
import { GLTable } from "./GLTable";
import { PrintExportButton } from "../../_components/PrintExportButton";
import { formatMoney } from "@/lib/formatters";

export default async function GeneralLedgerPage() {
  const { data: entries, source } = await getFinanceGLEntries();

  // debit/credit are minor-unit (paise) decimal strings — sum as BigInt, not
  // float addition, so large ledgers can't drift and formatMoney() (which
  // expects minor units) gets the right scale. See gl/queries.ts
  // listJournalEntries for the backend side of this contract.
  const totalDebit = entries.reduce((s, e) => s + BigInt(e.debit || "0"), 0n);
  const totalCredit = entries.reduce((s, e) => s + BigInt(e.credit || "0"), 0n);
  const uniqueAccounts = new Set(entries.map((e) => e.accountCode)).size;
  const isBalanced = totalDebit === totalCredit;

  return (
    <>
      <PageHeader
        title="General Ledger"
        subtitle="Double-entry ledger — every debit has a corresponding credit."
        actions={
          <>
            <PrintExportButton label="Export PDF" documentTitle="General Ledger" />
            <a href="/finance/accounting/vouchers/new" className="btn primary">+ New Voucher</a>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📒" iconBg="#e7edfd" label="Vouchers" value={entries.length} />
        <StatCard icon="🏛️" iconBg="#eff6ff" label="Accounts Active" value={uniqueAccounts} />
        <StatCard icon="📤" iconBg="#fef3f2" label="Total Debit" value={formatMoney(totalDebit)} />
        <StatCard icon="📥" iconBg="#ecfdf3" label="Total Credit" value={formatMoney(totalCredit)} delta={isBalanced ? "Balanced" : "Unbalanced"} up={isBalanced} />
      </StatGrid>

      <Card title="General ledger — all fiscal years">
        <GLTable entries={entries} source={source} />
      </Card>
    </>
  );
}
