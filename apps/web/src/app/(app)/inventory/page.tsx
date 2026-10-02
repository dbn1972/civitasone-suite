import { ModuleHub } from "../../_components/ModuleHub";
import { Card, StatGrid, StatCard, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { getInventoryLowStock, getInventoryItemForecast } from "./_data";
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
  const lowRes = await getInventoryLowStock();
  const lowFailed = lowRes.source === "error";
  const lowStock = lowRes.data;
  const topItem = lowStock[0];
  const forecastRes = !lowFailed && topItem ? await getInventoryItemForecast(topItem.itemId) : null;
  const forecastFailed = forecastRes?.source === "error";
  return (
    <ModuleHub
      title="Inventory"
      description="Government store management: item master, goods receipts, issues, transfers, stock-take and reorder alerts."
      links={[
        { href: "/inventory/items", label: "Item Master", note: "Catalogued items, categories, units and reorder policy" },
        { href: "/inventory/receipts", label: "Goods Receipts", note: "Stock received into stores (GRN-in)" },
        { href: "/inventory/issues", label: "Stock Issues", note: "Stock issued / consumed against indents" },
        { href: "/inventory/low-stock", label: "Low Stock & Reorder", note: "Items at/below reorder level with suggested reorder" },
        { href: "/inventory/bins", label: "Bins & Racks", note: "Physical bin/rack locations within stores" },
        { href: "/inventory/reservations", label: "Reservations", note: "Stock reserved against indents/POs (ATP hold)" },
        { href: "/inventory/goods-returns", label: "Goods Returns", note: "Returned/rejected stock with QC gate" },
        { href: "/inventory/substitutes", label: "Substitutes", note: "Allowed replacement items and conversion factors" },
        { href: "/inventory/list", label: "Stock Items", note: "All SKUs and current stock levels" },
        { href: "/inventory/reconcile", label: "Reconciliation", note: "Verify ledger vs. physical stock movements" },
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
        <Card title="Demand forecast — item nearest reorder" padding>
          <ForecastChart itemName={topItem.name} data={buildForecastSeries(forecastRes.data.dailyForecast)} />
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
