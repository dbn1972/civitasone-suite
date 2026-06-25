import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getStockItemById } from "../../../_data/loaders";
import { StatusPill, EmptyState } from "../../../_components/ds";
import { PrintExportButton } from "../_components/PrintExportButton";

export default async function StockItemDetailPage({ params }: { params: { id: string } }) {
  const { data: item, source } = await getStockItemById(params.id);

  if (!item) {
    return (
      <>
        <a className="back" href="/stock/list">← Back</a>
        <div className="ph" style={{ marginTop: 6 }}>
          <div><h1>Item not found</h1></div>
        </div>
        <p className="sub">The requested stock item could not be found.</p>
      </>
    );
  }

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <a className="back" href="/stock/list">← Back</a>
      <div className="ph" style={{ marginTop: 6 }}>
        <div>
          <h1>
            {item.itemCode} · {item.name}{" "}
            <StatusPill
              status={item.isLowStock ? "bad" : "active"}
              label={item.isLowStock ? "Low Stock" : "OK"}
            />
          </h1>
        </div>
        <div className="ph-act">
          <PrintExportButton label="Print Label" documentTitle={`${item.itemCode} · ${item.name}`} />
          <a href={`/stock/ledger/new?itemId=${params.id}`} className="btn primary">+ Stock Entry</a>
        </div>
      </div>
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Category</div><div className="v">{item.category}</div></div>
              <div className="fld"><div className="l">Unit</div><div className="v">{item.unit}</div></div>
              <div className="fld"><div className="l">On-hand qty</div><div className="v">{item.currentStock.toLocaleString("en-IN")}</div></div>
              <div className="fld"><div className="l">Min level</div><div className="v">{item.minStockLevel.toLocaleString("en-IN")}</div></div>
              <div className="fld"><div className="l">Unit cost</div><div className="v">₹{(item.unitCost / 100).toLocaleString("en-IN")}</div></div>
              <div className="fld"><div className="l">Total value</div><div className="v">₹{(item.totalValue / 100).toLocaleString("en-IN")}</div></div>
              <div className="fld"><div className="l">HSN Code</div><div className="v">{item.hsnCode ?? "—"}</div></div>
              <div className="fld"><div className="l">Warehouse</div><div className="v">{item.warehouseLocation ?? "—"}</div></div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Stock ledger</h3></div>
            {item.stockLedger.length === 0 ? (
              <EmptyState icon="📋" title="No ledger entries" message="Stock movements for this item will appear here." />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th className="num">Qty</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {item.stockLedger.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.date}</td>
                      <td><StatusPill status={entry.type} label={entry.type} /></td>
                      <td className="num">
                        {entry.type === "issue" ? "-" : "+"}{entry.quantity.toLocaleString("en-IN")}
                      </td>
                      <td className="num">{entry.balance.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
