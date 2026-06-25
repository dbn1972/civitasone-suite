import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getStockLedger } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { PrintExportButton } from "../_components/PrintExportButton";
import { formatMoney } from "@/lib/formatters";
import { StockLedgerClient } from "./StockLedgerClient";

export default async function StockLedgerPage() {
  const { data: entries, source } = await getStockLedger();
  const totalReceipts = entries.filter((e) => e.type === "receipt").reduce((sum, e) => sum + e.totalValue, 0);
  const totalIssues = entries.filter((e) => e.type === "issue").reduce((sum, e) => sum + e.totalValue, 0);
  const netBalance = totalReceipts - totalIssues;

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Stock Ledger"
        subtitle="All receipt, issue, transfer and adjustment transactions."
        actions={
          <>
            <PrintExportButton label="Export" documentTitle="Stock Ledger" />
            <a href="/stock/ledger/new" className="btn primary">+ New Entry</a>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f7f5" label="Total Entries" value={entries.length.toLocaleString("en-IN")} />
        <StatCard icon="📥" iconBg="#ecfdf3" label="Total Receipts" value={formatMoney(totalReceipts)} />
        <StatCard icon="📤" iconBg="#fef3f2" label="Total Issues" value={formatMoney(totalIssues)} />
        <StatCard icon="⚖️" iconBg="#eff6ff" label="Net Balance" value={formatMoney(netBalance)} />
      </StatGrid>
      <StockLedgerClient entries={entries} />
    </>
  );
}
