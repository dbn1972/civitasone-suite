import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getProcurementGem } from "../../../_data/loaders";
import { GemTable } from "./GemTable";

export default async function GemPage() {
  const { data: items, source } = await getProcurementGem();

  const delivered = items.filter((i) => i.gemStatus === "Delivered").length;
  const inTransit = items.filter((i) => i.gemStatus === "In Transit" || i.gemStatus === "Shipped").length;
  const totalValuePaise = items.reduce((sum, i) => sum + i.amount, 0);
  const totalValueDisplay = totalValuePaise > 0 ? `₹${(totalValuePaise / 100).toLocaleString("en-IN")}` : "₹0";

  return (
    <>
      <PageHeader
        title="GeM Integration"
        subtitle="Government e-Marketplace orders and delivery tracking."
        actions={source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
      />

      <StatGrid>
        <StatCard icon="🛒" iconBg="#eef2ff" label="Total Orders" value={items.length} />
        <StatCard icon="📦" iconBg="#ecfdf3" label="Delivered" value={delivered} />
        <StatCard icon="🚚" iconBg="#fffaeb" label="In Transit" value={inTransit} />
        <StatCard icon="💰" iconBg="#fce7ee" label="Total Value" value={totalValueDisplay} />
      </StatGrid>

      <GemTable items={items} source={source} />
    </>
  );
}
