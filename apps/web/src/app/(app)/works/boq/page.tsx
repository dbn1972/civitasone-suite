import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getBoqItems } from "../_data/loaders";
import { BoqTable } from "./BoqTable";

export default async function BoqPage() {
  const { data: items, source } = await getBoqItems();

  const total = items.length;
  const totalAmountMinor = items.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const totalAmount = (totalAmountMinor / 100).toLocaleString("en-IN");
  const scopes = new Set(items.map((i) => String(i.scope ?? ""))).size;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Bill of Quantities"
        subtitle="SR items, measurements, and recapitulation for works."
        back="/works"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {source === "error" && <DataSourceBadge source={source} />}
            <Link
              href="/works/boq/new"
              className="btn primary"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + Add BoQ item
            </Link>
          </div>
        }
      />
      <StatGrid>
        <StatCard icon="📐" iconBg="#eff6ff" label="Total Items" value={total} />
        <StatCard icon="💰" iconBg="#ecfdf3" label="Total Amount" value={"Rs. " + totalAmount} />
        <StatCard icon="📊" iconBg="#fffaeb" label="Scopes" value={scopes} />
        <StatCard
          icon="📋"
          iconBg="#f0fdf4"
          label="SR Items"
          value={items.filter((i) => i.itemCode && i.itemCode !== "—").length}
        />
      </StatGrid>
      <Card title="BoQ Items">
        <BoqTable items={items} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
