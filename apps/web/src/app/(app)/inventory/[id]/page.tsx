import Link from "next/link";
import { getStockItemById } from "../../../_data/loaders";
import {
  StatusPill,
  EmptyState,
  DataTable,
  PageHeader,
  LoadErrorState,
} from "../../../_components/ds";
import { PrintExportButton } from "../../stock/_components/PrintExportButton";
import { formatMoney, formatIndianDate } from "@/lib/formatters";

const LEDGER_COLUMNS = [
  { key: "date" as const, label: "Date" },
  { key: "type" as const, label: "Type", cellType: "status" as const },
  { key: "quantityDisplay" as const, label: "Qty", align: "right" as const },
  { key: "balance" as const, label: "Balance", align: "right" as const },
];

// REL-023: relocated from apps/web/src/app/(app)/stock/[id]/page.tsx.
// next.config.mjs permanently redirects /stock/:path* -> /inventory/:path*
// ("Legacy /stock/* routes -> /inventory/* (requirement 1.7)"), which made
// this exact page unreachable dead code (Next applies redirects() before
// matching any page file) while every row-link in InventoryStockListClient
// and every "back" link on this page itself still pointed at /stock/<id> --
// so a real user clicking a stock item row landed on inventory/not-found.tsx.
// Content is unchanged from the old page other than the two /stock/list ->
// /inventory/list "back" links below (the redirect already made the old
// href work, just via an extra hop); everything else (loader, ledger table,
// field labels) is identical to what was already live before the rename.
export default async function StockItemDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const result = await getStockItemById(params.id);
  const { data: item } = result;

  // GAP-INVENTORY-DETAIL-01: fetchJson returns {data:null, source:"error"} for
  // ANY failure, so a 5xx/timeout/403 used to render "Item not found". Only a
  // real 404 is "not found"; every other failure is a retryable/permission state.
  if (result.source === "error" && result.status !== 404) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Stock item" back="/inventory/list" />
        <LoadErrorState result={result} area="stock item" backHref="/inventory/list" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Item not found" back="/inventory/list" />
        <p className="sub">The requested stock item could not be found.</p>
      </div>
    );
  }

  const ledgerRows = item.stockLedger.map((entry) => ({
    id: entry.id,
    date: formatIndianDate(entry.date),
    type: entry.type,
    quantityDisplay: `${entry.direction === "out" ? "-" : "+"}${entry.quantity.toLocaleString("en-IN")}`,
    balance: entry.balance.toLocaleString("en-IN"),
  }));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={
          <>
            {item.itemCode} · {item.name}{" "}
            <StatusPill
              status={item.isLowStock ? "low stock" : "active"}
              label={item.isLowStock ? "Low Stock" : "OK"}
            />
          </>
        }
        back="/inventory/list"
        actions={
          <>
            <PrintExportButton
              label="Print Label"
              documentTitle={`${item.itemCode} · ${item.name}`}
            />
            {/* GAP-INVENTORY-DETAIL-02: /stock/:path* is permanently redirected to
                /inventory/:path*, so the entry form now lives at
                /inventory/ledger/new (it used to be an unreachable stock/ledger/new). */}
            <Link href={`/inventory/ledger/new?itemId=${encodeURIComponent(params.id)}`} className="btn primary">
              + Stock Entry
            </Link>
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
            {item.stockLedger.length === 0 ? ( // ux-001-ok: a failed fetch returns above (LoadErrorState) and a 404 returns "Item not found", so `item` here is real -- this is a genuinely ledger-free item, never a masked fetch failure
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
    </div>
  );
}
