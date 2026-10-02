import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { getStockItems } from "../../../_data/loaders";
import { getInventoryCycleCounts, type InventoryCycleCountRow } from "../_data";
import { itemLabel, nameOrDash } from "../_labels";
import { stockListStats } from "./listStats";
import { InventoryStockListClient } from "./InventoryStockListClient";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

// GAP-INVENTORY-LIST-COUNTEDAT (SF-08): this is a Server Component (no
// "use client") -- a `render` function prop can't cross the RSC boundary
// into DataTable ("use client") and would throw at runtime on every load,
// the same crash class as GAP-HR-EXPENSES-01 / PR #1647. DataTable's own
// `cellType: "date"` is server-safe: it formats via the shared
// formatIndianDate() helper, the exact function this file's own (now
// removed) render closure called directly.
// GAP-INVENTORY-LIST-03: item and warehouse are shown by name (resolved in the
// loader); the ids stay only in the row link.
type PendingCountRow = InventoryCycleCountRow & { itemText: string; warehouseText: string };

const CYCLE_COUNT_COLUMNS = [
  { key: "countedAt" as const, label: "Counted", cellType: "date" as const },
  { key: "itemText" as const, label: "Item" },
  { key: "warehouseText" as const, label: "Warehouse" },
  { key: "systemQty" as const, label: "System qty", align: "right" as const },
  { key: "physicalQty" as const, label: "Physical qty", align: "right" as const },
  { key: "variance" as const, label: "Variance", align: "right" as const },
  { key: "reasonCode" as const, label: "Reason" },
  { key: "status" as const, label: "Status", cellType: "status" as const },
];

export default async function InventoryListPage() {
  const [{ data: items, source }, pendingRes] = await Promise.all([
    getStockItems(),
    getInventoryCycleCounts("pending_approval"),
  ]);

  // GAP-INVENTORY-LIST-01: a failed fetch yields items=[] -- never present that as
  // an unstocked store (zero SKUs, Rs 0 value, "Add stock items"). Stats read
  // "—" and the register is replaced by a retry state.
  const failed = source === "error";
  // GAP-INVENTORY-LIST-03: a failed cycle-count fetch must not silently hide the
  // approvals waiting on a supervisor -- it gets its own retry notice.
  const pendingFailed = pendingRes.source === "error";
  const pendingRows: PendingCountRow[] = pendingRes.data.map((c) => ({
    ...c,
    itemText: itemLabel(c),
    warehouseText: nameOrDash(c.warehouseName),
  }));
  // Unknown levels/values are excluded rather than shown as 0 (see listStats.ts).
  const stats = stockListStats(items, failed);

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader
        title="Stock Items"
        subtitle="Stock levels per item from the stock service. The catalogued item master, with categories and reorder policy, is under Item Master."
      />
      <div aria-label="Inventory stock items">
        <StatGrid>
          <StatCard icon="📦" iconBg="#f1f5f9" label="Total SKUs" value={stats.total} />
          <StatCard icon="⚠️" iconBg="#fee2e2" label="Low Stock" value={stats.lowStock} />
          <StatCard icon="💰" iconBg="#eff6ff" label={stats.valueLabel} value={stats.valueText} />
        </StatGrid>

        {pendingFailed ? (
          <Card title="Cycle counts pending approval">
            <RefreshErrorState error={toHumanError("load", { area: "pending cycle-count approvals" })} />
          </Card>
        ) : pendingRows.length > 0 ? (
          <Card title="Cycle counts pending approval">
            <DataTable<PendingCountRow>
              columns={CYCLE_COUNT_COLUMNS}
              rows={pendingRows}
              rowLinkPrefix="/inventory/cycle-counts/"
              rowLinkKey="id"
              pageSize={15}
            />
          </Card>
        ) : null}

        {failed ? (
          <RefreshErrorState error={toHumanError("load", { area: "stock items" })} backHref="/inventory" />
        ) : (
          <InventoryStockListClient items={items} />
        )}
      </div>
    </>
  );
}
