import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getStockLedger } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { PrintExportButton } from "../_components/PrintExportButton";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { StockLedgerClient } from "./StockLedgerClient";

export default async function StockLedgerPage() {
  const { data: entries, source } = await getStockLedger();
  // GAP-STOCK-LEDGER-01: a failed load must not render as an empty ledger with
  // zero totals. Totals are unknown (null -> "—") when the load errored.
  const errored = source === "error";
  const totalReceipts = errored ? null : entries.filter((e) => e.type === "receipt").reduce((sum, e) => sum + e.totalValue, 0);
  const totalIssues = errored ? null : entries.filter((e) => e.type === "issue").reduce((sum, e) => sum + e.totalValue, 0);
  const netBalance = totalReceipts === null || totalIssues === null ? null : totalReceipts - totalIssues;

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
        <StatCard icon="📋" iconBg="#e6f7f5" label="Total Entries" value={errored ? "—" : entries.length.toLocaleString("en-IN")} />
        <StatCard icon="📥" iconBg="#ecfdf3" label="Total Receipts" value={totalReceipts === null ? "—" : formatMoney(totalReceipts)} />
        <StatCard icon="📤" iconBg="#fef3f2" label="Total Issues" value={totalIssues === null ? "—" : formatMoney(totalIssues)} />
        <StatCard icon="⚖️" iconBg="#eff6ff" label="Net Receipts − Issues" value={netBalance === null ? "—" : formatMoney(netBalance)} />
      </StatGrid>
      {errored ? (
        <div className="card" style={{ marginTop: 18 }}>
          <RefreshErrorState error={toHumanError("load", { area: "stock ledger" })} />
        </div>
      ) : (
        <StockLedgerClient entries={entries} />
      )}
    </>
  );
}
