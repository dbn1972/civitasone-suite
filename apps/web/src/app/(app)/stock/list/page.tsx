import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PrintExportButton } from "../../../_components/PrintExportButton";
import { getStockItems } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import Link from "next/link";
import { StockListClient } from "./StockListClient";

export default async function StockListPage() {
  const { data: items, source } = await getStockItems();
  const errored = source === "error";
  const lowStockCount = errored ? null : items.filter((i) => i.isLowStock).length;
  const totalValue = errored ? null : items.reduce((sum, i) => sum + i.totalValue, 0);
  const categories = errored ? null : new Set(items.map((i) => i.category)).size;

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Stock Items"
        subtitle="All stock-keeping units, levels and valuations."
        actions={
          <>
            <PrintExportButton label="Export" documentTitle="Stock Items" />
            <Link className="btn primary" href="/stock/items/new">+ New Item</Link>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="🏬" iconBg="#e6f7f5" label="SKUs" value={errored ? "—" : items.length.toLocaleString("en-IN")} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Stock Value" value={totalValue === null ? "—" : formatMoney(totalValue)} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Low Stock" value={lowStockCount === null ? "—" : lowStockCount.toLocaleString("en-IN")} />
        <StatCard icon="📦" iconBg="#ecfdf3" label="Categories" value={categories === null ? "—" : categories.toLocaleString("en-IN")} />
      </StatGrid>
      {errored ? (
        <div className="card" style={{ marginTop: 18 }}>
          <RefreshErrorState error={toHumanError("load", { area: "stock items" })} />
        </div>
      ) : items.length === 0 ? (
        <div className="card" style={{ marginTop: 18 }}>
          <EmptyState icon="📦" title="No stock items found" message="Add stock items to track inventory levels." />
        </div>
      ) : (
        <StockListClient items={items} />
      )}
    </>
  );
}
