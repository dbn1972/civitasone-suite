import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getFinanceGLEntries } from "../../../../_data/loaders";
import { GLTable } from "./GLTable";

export default async function GeneralLedgerPage() {
  const { data: entries, source } = await getFinanceGLEntries();

  const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0);
  const uniqueAccounts = new Set(entries.map((e) => e.accountCode)).size;
  const isBalanced = totalDebit === totalCredit;

  return (
    <>
      <PageHeader
        title="General Ledger"
        subtitle="Double-entry ledger — every debit has a corresponding credit."
        actions={
          <>
            <button className="btn ghost">Export PDF</button>
            <a href="/finance/accounting/vouchers/new" className="btn primary">+ New Voucher</a>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📒" iconBg="#e7edfd" label="Vouchers" value={entries.length} />
        <StatCard icon="🏛️" iconBg="#eff6ff" label="Accounts Active" value={uniqueAccounts} />
        <StatCard icon="📤" iconBg="#fef3f2" label="Total Debit" value={`₹${(totalDebit / 100).toLocaleString("en-IN")}`} />
        <StatCard icon="📥" iconBg="#ecfdf3" label="Total Credit" value={`₹${(totalCredit / 100).toLocaleString("en-IN")}`} delta={isBalanced ? "Balanced" : "Unbalanced"} up={isBalanced} />
      </StatGrid>

      <Card title="General ledger · FY 2026-27">
        <GLTable entries={entries} source={source} />
      </Card>
    </>
  );
}
