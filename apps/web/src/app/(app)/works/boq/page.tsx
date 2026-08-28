import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { getBoqItems } from "../_data/loaders";
import { BoqTable } from "./BoqTable";

export default async function BoqPage() {
  const { data: items, source } = await getBoqItems();

  const total = items.length;
  // amount is amountMinor (paise) serialised as a string — sum with BigInt and
  // render via formatMoney so the total is paise-exact and matches the ₹ format
  // used everywhere else (never float-divide paise or drop trailing zeros).
  const totalAmountMinor = items.reduce((sum, item) => {
    try {
      return sum + BigInt(String(item.amount ?? "0"));
    } catch {
      return sum;
    }
  }, 0n);
  const totalAmount = formatMoney(totalAmountMinor);
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
        <StatCard icon="💰" iconBg="#ecfdf3" label="Total Amount" value={totalAmount} />
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
