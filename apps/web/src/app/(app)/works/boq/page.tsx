import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { BoqTable } from "./BoqTable";

type ApiBoqItem = Record<string, unknown>;

async function getBoqItems() {
  return fetchJson<unknown, ApiBoqItem[]>("/api/v1/works/boq", [], {
    telemetryKey: "works.boq",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiBoqItem[] })?.data;
      return Array.isArray(arr) ? (arr as ApiBoqItem[]) : null;
    },
  });
}

export default async function BoqPage() {
  const { data: items, source } = await getBoqItems();

  const total = items.length;
  const totalAmount = items.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
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
        <StatCard icon="📋" iconBg="#f0fdf4" label="SR Items" value={items.filter((i) => i.itemCode).length} />
      </StatGrid>
      <Card title="BoQ Items">
        <BoqTable items={items} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
