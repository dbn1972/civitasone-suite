import { ModuleHub } from "../../_components/ModuleHub";
import { Card, StatGrid, StatCard, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import {
  getInventoryCycleCounts,
  getInventoryGoodsReturns,
  getInventoryItemForecast,
  getInventoryLowStock,
} from "./_data";
import { countBadge, pickMostBelowReorder } from "./hubStats";
import { INVENTORY_LIST_LIMIT } from "./_limits";
import { ForecastChart, type ForecastPoint } from "./ForecastChart";

function buildForecastSeries(dailyForecast: number[]): ForecastPoint[] {
  const start = new Date();
  return dailyForecast.map((qty, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return { date: d.toISOString().slice(0, 10), qty };
  });
}

export default async function Page() {
  // GAP-INVENTORY-HOME-01: keep the whole loader result. An outage used to
  // collapse to lowStock=[] and the hub looked like a healthy store with no
  // alerts -- the Low Stock alert is the one number this hub exists to show.
  // GAP-INVENTORY-HOME-03: the tile counts are fetched in parallel with the
  // low-stock list; each is independent, so one failing shows "—" on its own tile.
  const [lowRes, returnsRes, countsRes] = await Promise.all([
    getInventoryLowStock(),
    getInventoryGoodsReturns({ names: false }),
    getInventoryCycleCounts("pending_approval", { names: false }),
  ]);
  const lowFailed = lowRes.source === "error";
  const lowStock = lowRes.data;
  // GAP-INVENTORY-HOME-02: chart the item furthest below its reorder level, not
  // whichever row the API happened to list first.
  const topItem = pickMostBelowReorder(lowStock);
  const pendingQc = returnsRes.source === "error" ? null : returnsRes.data.filter((r) => r.qcStatus === "pending").length;
  const pendingCounts = countsRes.source === "error" ? null : countsRes.data.length;
  const forecastRes = !lowFailed && topItem ? await getInventoryItemForecast(topItem.itemId) : null;
  const forecastFailed = forecastRes?.source === "error";
  return (
    <ModuleHub
      title="Inventory"
      description="Government store management: item master, goods receipts, issues, transfers, stock-take and reorder alerts."
      links={[
        { href: "/inventory/items", label: "Item Master", note: "Catalogued items, categories, units and reorder policy" },
        { href: "/inventory/receipts", label: "Goods Receipts", note: "Stock received into stores (GRN-in)" },
        { href: "/inventory/issues", label: "Stock Issues", note: "Stock issued or consumed from stores" },
        { href: "/inventory/low-stock", label: "Low Stock & Reorder", note: "Items at/below reorder level with suggested reorder", badge: countBadge(lowFailed ? null : lowStock.length, "low") },
        { href: "/inventory/bins", label: "Bins & Racks", note: "Physical bin/rack locations within stores" },
        { href: "/inventory/reservations", label: "Reservations", note: "Stock reserved against indents/POs (ATP hold)" },
        { href: "/inventory/goods-returns", label: "Goods Returns", note: "Returned/rejected stock with QC gate", badge: countBadge(pendingQc, "pending QC", returnsRes.data.length >= INVENTORY_LIST_LIMIT) },
        { href: "/inventory/substitutes", label: "Substitutes", note: "Allowed replacement items and conversion factors" },
        { href: "/inventory/list", label: "Stock Items", note: "All SKUs and current stock levels, and cycle counts awaiting approval", badge: countBadge(pendingCounts, "counts to approve", countsRes.data.length >= INVENTORY_LIST_LIMIT) },
        { href: "/inventory/reconcile", label: "Stock Movements Summary", note: "Receipts, issues and adjustments from the stock ledger" },
      ]}
    >
      {lowFailed ? (
        <Card padding>
          <RefreshErrorState error={toHumanError("load", { area: "low-stock alerts" })} />
        </Card>
      ) : null}
      <StatGrid>
        <StatCard icon="⚠️" iconBg="#fee2e2" label="Items Low" value={lowFailed ? null : lowStock.length} />
      </StatGrid>
      {!lowFailed && topItem && forecastRes?.data.available ? (
        <Card title="Demand forecast — item furthest below its reorder level" padding>
          <ForecastChart
            itemName={topItem.name}
            data={buildForecastSeries(forecastRes.data.dailyForecast)}
            totalDemand={forecastRes.data.totalDemand}
            confidence={forecastRes.data.confidence}
          />
        </Card>
      ) : null}
      {forecastFailed ? (
        <p role="status" style={{ fontSize: 13, color: "#92400e", margin: "0 0 12px" }}>
          Forecast unavailable right now.
        </p>
      ) : null}
    </ModuleHub>
  );
}
