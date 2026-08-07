import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PrintExportButton } from "../../../_components/PrintExportButton";
import { getStockItems } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState } from "../../../_components/ds";
import { formatMoney } from "@/lib/formatters";
import Link from "next/link";
import { StockListClient } from "./StockListClient";

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
            <PrintExportButton label="Export" documentTitle="Stock Items" />
            <Link className="btn primary" href="/stock/items/new">+ New Item</Link>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="🏬" iconBg="#e6f7f5" label="SKUs" value={items.length.toLocaleString("en-IN")} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Stock Value" value={formatMoney(totalValue)} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Low Stock" value={lowStockCount.toLocaleString("en-IN")} />
        <StatCard icon="📦" iconBg="#ecfdf3" label="Categories" value={categories.toLocaleString("en-IN")} />
      </StatGrid>
      {items.length === 0 ? (
        <div className="card" style={{ marginTop: 18 }}>
          <EmptyState icon="📦" title="No stock items found" message="Add stock items to track inventory levels." />
        </div>
      ) : (
        <StockListClient items={items} />
      )}
    </>
  );
}
