import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getStockDashboard, getStockLedger } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, DataTable, RefreshErrorState } from "../../../_components/ds";
import { PrintExportButton } from "../_components/PrintExportButton";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

const MOVEMENT_COLUMNS = [
  { key: "date" as const, label: "Date" },
  { key: "itemCode" as const, label: "Item code" },
  { key: "itemName" as const, label: "Item" },
  { key: "type" as const, label: "Type", cellType: "status" as const },
  { key: "signedQuantity" as const, label: "Qty", align: "right" as const },
];

export default async function StockDashboardPage() {
  const [{ data, source }, ledger] = await Promise.all([
    getStockDashboard(),
    getStockLedger({ limit: 5 }),
  ]);
  const errored = source === "error";

  // GAP-STOCK-DASHBOARD-02: on a failed load show an honest "—"/error state
  // instead of fabricated zeros (a hidden low-stock/stock-out count would mask
  // a real stock-out). GAP-STOCK-DASHBOARD-01: never render a trend delta.
  const skuValue = errored ? "—" : data.totalSKUs.toLocaleString("en-IN");
  const stockValue = errored ? "—" : formatMoney(data.inventoryValue);
  const lowStockValue = errored ? "—" : data.lowStockAlerts.toLocaleString("en-IN");
  const stockOutValue = errored ? "—" : data.stockOuts.toLocaleString("en-IN");

  const movements = ledger.source === "error" ? [] : ledger.data;
  const movementsErrored = ledger.source === "error";

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Stock & Inventory"
        subtitle="SKU tracking, GRN management and inventory valuation."
        actions={
          <>
            <PrintExportButton label="Print" documentTitle="Stock & Inventory" />
            <Link href="/stock/ledger/new" className="btn primary">+ New Entry</Link>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="🏬" iconBg="#e6f7f5" label="SKUs" value={skuValue} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Stock Value" value={stockValue} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Low Stock" value={lowStockValue} href="/inventory/low-stock" />
        <StatCard icon="🚫" iconBg="#fef3f2" label="Stock-outs" value={stockOutValue} />
      </StatGrid>
      <div className="grid g-main" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h">
              <h3>Stock Movements</h3>
              <Link className="lnk" href="/stock/ledger">Full ledger →</Link>
            </div>
            {movementsErrored ? (
              <RefreshErrorState error={toHumanError("load", { area: "stock movements" })} />
            ) : movements.length === 0 ? (
              <EmptyState icon="📦" title="No recent movements" message="Stock receipts, issues and transfers appear here." />
            ) : (
              <DataTable
                columns={MOVEMENT_COLUMNS}
                rows={movements as unknown as Record<string, unknown>[]}
                identifyingColumnKey="itemName"
              />
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h">
              <h3>GRNs this month</h3>
              {errored ? null : <span className="pill info">{data.grnsThisMonth}</span>}
            </div>
            {errored ? (
              <RefreshErrorState error={toHumanError("load", { area: "stock dashboard" })} />
            ) : (
              <div className="pad" style={{ fontSize: 13 }}>
                <p style={{ margin: "0 0 10px" }}>
                  Goods receipts are recorded in Procurement.
                </p>
                <Link className="btn ghost" href="/procurement/grn">Open Goods Receipts →</Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
