import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getStockDashboard } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState } from "../../../_components/ds";

export default async function StockDashboardPage() {
  const { data, source } = await getStockDashboard();

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Stock & Inventory"
        subtitle="SKU tracking, GRN management and inventory valuation."
        actions={
          <>
            <button className="btn ghost">Export</button>
            <button className="btn primary">+ New</button>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="🏬" iconBg="#e6f7f5" label="SKUs" value={data.totalSKUs.toLocaleString("en-IN")} delta="+120" up />
        <StatCard icon="💰" iconBg="#eff6ff" label="Stock Value" value={`₹${(data.inventoryValue / 100).toLocaleString("en-IN")}`} delta="+1.8%" up />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Low Stock" value={data.lowStockAlerts.toLocaleString("en-IN")} />
        <StatCard icon="🚫" iconBg="#fef3f2" label="Stock-outs" value="—" />
      </StatGrid>
      <div className="grid g-main" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h">
              <h3>Stock Movements</h3>
              <a className="lnk" href="/stock/list">All items →</a>
            </div>
            <EmptyState icon="📦" title="No recent movements" message="Stock receipts, issues and transfers appear here." />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h">
              <h3>GRNs this month</h3>
              <span className="pill info">{data.grnsThisMonth}</span>
            </div>
            <EmptyState icon="📋" title="No recent GRNs" message="Goods receipt notes will appear here." />
          </div>
        </div>
      </div>
    </>
  );
}
