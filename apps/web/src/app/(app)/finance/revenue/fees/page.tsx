import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceFees } from "@/app/_data/loaders";
import { FeesTable } from "./FeesTable";

export default async function FeesPage() {
  const { data: fees, source } = await getFinanceFees();
  const collected = fees.filter((f) => String(f.status).toLowerCase() === "collected").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Fees Collection" subtitle="Statutory fees and application fee register." back="/finance" actions={source === "error" ? <DataSourceBadge source={source} /> : null} />
      <StatGrid>
        <StatCard icon="🎫" iconBg="#e7edfd" label="Total Fee Items" value={fees.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Collected" value={collected} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={fees.length - collected} />
        <StatCard icon="📋" iconBg="#eff6ff" label="Categories" value={new Set(fees.map((f) => String(f.category ?? ""))).size} />
      </StatGrid>
      <Card title="Fee Register"><FeesTable fees={fees} source={source === "error" ? "error" : "api"} /></Card>
    </main>
  );
}
