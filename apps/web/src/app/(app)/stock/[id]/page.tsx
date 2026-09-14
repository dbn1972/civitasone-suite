import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getStockItemById } from "../../../_data/loaders";
import {
  StatusPill,
  EmptyState,
  DataTable,
  PageHeader,
} from "../../../_components/ds";
import { PrintExportButton } from "../_components/PrintExportButton";
import { formatMoney, formatIndianDate } from "@/lib/formatters";

const LEDGER_COLUMNS = [
  { key: "date" as const, label: "Date" },
  { key: "type" as const, label: "Type", cellType: "status" as const },
  { key: "quantityDisplay" as const, label: "Qty", align: "right" as const },
  { key: "balance" as const, label: "Balance", align: "right" as const },
];

export default async function StockItemDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { data: item, source } = await getStockItemById(params.id);

  if (!item) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Item not found" back="/stock/list" />
        <p className="sub">The requested stock item could not be found.</p>
      </main>
    );
  }

  const ledgerRows = item.stockLedger.map((entry) => ({
    id: entry.id,
    date: formatIndianDate(entry.date),
    type: entry.type,
    quantityDisplay: `${entry.type === "issue" ? "-" : "+"}${entry.quantity.toLocaleString("en-IN")}`,
    balance: entry.balance.toLocaleString("en-IN"),
  }));

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={
          <>
            {item.itemCode} · {item.name}{" "}
            <StatusPill
              status={item.isLowStock ? "bad" : "active"}
              label={item.isLowStock ? "Low Stock" : "OK"}
            />
          </>
        }
        back="/stock/list"
        actions={
          <>
            {source === "error" && <DataSourceBadge source={source} />}
            <PrintExportButton
              label="Print Label"
              documentTitle={`${item.itemCode} · ${item.name}`}
            />
            <a
              href={`/stock/ledger/new?itemId=${params.id}`}
              className="btn primary"
            >
              + Stock Entry
            </a>
          </>
        }
      />
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h">
              <h3>Details</h3>
            </div>
            <div className="fields">
              <div className="fld">
                <div className="l">Category</div>
                <div className="v">{item.category}</div>
              </div>
              <div className="fld">
                <div className="l">Unit</div>
                <div className="v">{item.unit}</div>
              </div>
              <div className="fld">
                <div className="l">On-hand qty</div>
                <div className="v">
                  {item.currentStock.toLocaleString("en-IN")}
                </div>
              </div>
              <div className="fld">
                <div className="l">Min level</div>
                <div className="v">
                  {item.minStockLevel.toLocaleString("en-IN")}
                </div>
              </div>
              <div className="fld">
                <div className="l">Unit cost</div>
                <div className="v">{formatMoney(item.unitCost)}</div>
              </div>
              <div className="fld">
                <div className="l">Total value</div>
                <div className="v">{formatMoney(item.totalValue)}</div>
              </div>
              <div className="fld">
                <div className="l">HSN Code</div>
                <div className="v">{item.hsnCode ?? "—"}</div>
              </div>
              <div className="fld">
                <div className="l">Warehouse</div>
                <div className="v">{item.warehouseLocation ?? "—"}</div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h">
              <h3>Stock ledger</h3>
            </div>
            {item.stockLedger.length === 0 ? (
              <EmptyState
                icon="📋"
                title="No ledger entries"
                message="Stock movements for this item will appear here."
              />
            ) : (
              <DataTable
                columns={LEDGER_COLUMNS}
                rows={ledgerRows}
                sortable
                filterable
                pageSize={15}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
