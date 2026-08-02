import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getBoqItems } from "../_data/loaders";
import { BoqTable } from "./BoqTable";

export default async function BoqPage() {
  const { data: items, source } = await getBoqItems();

  const total = items.length;
  // amountMinor is paise; divide by 100 for the rupee total shown in the stat card.
  const totalAmountMinor = items.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const totalAmount = totalAmountMinor / 100;
  const scopes = new Set(items.map((i) => String(i.scope ?? ""))).size;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Bill of Quantities"
        subtitle="SR items, measurements, and recapitulation for works."
        back="/works"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="📐" iconBg="#eff6ff" label="Total Items" value={total} />
        <StatCard icon="💰" iconBg="#ecfdf3" label="Total Amount" value={`₹${totalAmount.toLocaleString("en-IN")}`} />
        <StatCard icon="📊" iconBg="#fffaeb" label="Scopes" value={scopes} />
        <StatCard icon="📋" iconBg="#f0fdf4" label="SR Items" value={items.filter((i) => i.itemCode && i.itemCode !== "—").length} />
      </StatGrid>
      <Card title="BoQ Items">
        <BoqTable items={items} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
