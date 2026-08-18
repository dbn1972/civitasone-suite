import { ModuleHub } from "../../_components/ModuleHub";
import { Card } from "@/app/_components/ds";
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
  const { data: lowStock } = await getInventoryLowStock();
  const topItem = lowStock[0];
  const forecast = topItem ? await getInventoryItemForecast(topItem.itemId) : null;

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
      {topItem && forecast?.data.available ? (
        <Card title="Demand forecast — item nearest reorder" padding>
          <ForecastChart itemName={topItem.name} data={buildForecastSeries(forecast.data.dailyForecast)} />
        </Card>
      ) : null}
    </ModuleHub>
  );
}
