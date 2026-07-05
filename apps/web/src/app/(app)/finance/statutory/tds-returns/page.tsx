import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceTDSReturns } from "@/app/_data/loaders";
import { TDSReturnsTable } from "./TDSReturnsTable";

export default async function TDSReturnsPage() {
  const { data: returns, source } = await getFinanceTDSReturns();
  const filed = returns.filter((r) => String(r.status).toLowerCase() === "filed").length;
  const pending = returns.filter((r) => String(r.status).toLowerCase() === "pending").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="TDS Returns"
        subtitle="Quarterly TDS filing and Form 16A issuance."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="📑" iconBg="#e7edfd" label="Total Returns" value={returns.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Filed" value={filed} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={pending} />
        <StatCard icon="📊" iconBg="#eff6ff" label="Quarters" value={new Set(returns.map((r) => String(r.quarter ?? ""))).size} />
      </StatGrid>
      <Card title="TDS Returns">
        <TDSReturnsTable returns={returns} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
