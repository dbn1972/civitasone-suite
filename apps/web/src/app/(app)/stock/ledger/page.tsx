import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getStockLedger } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, StatusPill, EmptyState } from "../../../_components/ds";
import { PrintExportButton } from "../_components/PrintExportButton";

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
        <StatCard icon="📥" iconBg="#ecfdf3" label="Total Receipts" value={`₹${(totalReceipts / 100).toLocaleString("en-IN")}`} />
        <StatCard icon="📤" iconBg="#fef3f2" label="Total Issues" value={`₹${(totalIssues / 100).toLocaleString("en-IN")}`} />
        <StatCard icon="⚖️" iconBg="#eff6ff" label="Net Balance" value={`₹${(netBalance / 100).toLocaleString("en-IN")}`} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Stock ledger</h3>
          <div className="seg">
            <span className="on">All</span>
            <span>Receipts</span>
            <span>Issues</span>
          </div>
        </div>
        {entries.length === 0 ? (
          <EmptyState icon="📋" title="No ledger entries" message="Stock movements will appear here." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Item</th>
                <th>Warehouse</th>
                <th className="num">Qty</th>
                <th>Type</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.date}</td>
                  <td>
                    <span className="mono">{entry.itemCode}</span>
                    {" "}{entry.itemName}
                  </td>
                  <td>{entry.party ?? "—"}</td>
                  <td className="num">
                    {entry.type === "issue" ? "-" : "+"}{entry.quantity.toLocaleString("en-IN")}
                  </td>
                  <td>
                    <StatusPill status={entry.type} label={entry.type} />
                  </td>
                  <td className="num">{entry.balance.toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
