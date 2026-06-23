import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getStockItems } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, StatusPill, EmptyState } from "../../../_components/ds";

export default async function StockListPage() {
  const { data: items, source } = await getStockItems();
  const lowStockCount = items.filter((i) => i.isLowStock).length;
  const totalValue = items.reduce((sum, i) => sum + i.totalValue, 0);
  const categories = new Set(items.map((i) => i.category)).size;

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Stock Items"
        subtitle="All stock-keeping units, levels and valuations."
        actions={
          <>
            <button className="btn ghost">Export</button>
            <button className="btn primary">+ New Item</button>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="🏬" iconBg="#e6f7f5" label="SKUs" value={items.length.toLocaleString("en-IN")} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Stock Value" value={`₹${(totalValue / 100).toLocaleString("en-IN")}`} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Low Stock" value={lowStockCount.toLocaleString("en-IN")} />
        <StatCard icon="📦" iconBg="#ecfdf3" label="Categories" value={categories.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Stock register</h3>
          <div className="seg">
            <span className="on">All</span>
            <span>Low stock</span>
          </div>
        </div>
        {items.length === 0 ? (
          <EmptyState icon="📦" title="No stock items found" message="Add stock items to track inventory levels." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Item code</th>
                <th>Name</th>
                <th>UOM</th>
                <th className="num">On-hand qty</th>
                <th className="num">Value ₹</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="clickable">
                  <td>
                    <a href={`/stock/${item.id}`}>
                      <span className="mono">{item.itemCode}</span>
                    </a>
                  </td>
                  <td>{item.name}</td>
                  <td>{item.unit}</td>
                  <td className="num">{item.currentStock.toLocaleString("en-IN")}</td>
                  <td className="num">₹{(item.totalValue / 100).toLocaleString("en-IN")}</td>
                  <td>
                    <StatusPill
                      status={item.isLowStock ? "bad" : "active"}
                      label={item.isLowStock ? "Low Stock" : "OK"}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
