import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceRBI } from "@/app/_data/loaders";
import { RBITable } from "./RBITable";

export default async function RbiPage() {
  const { data: investments, source } = await getFinanceRBI();
  const active = investments.filter((i) => String(i.status).toLowerCase() === "active").length;
  const matured = investments.filter((i) => String(i.status).toLowerCase() === "matured").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="RBI / Treasury Investments"
        subtitle="Treasury bills, bonds, and term deposit investments."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="🏦" iconBg="#e7edfd" label="Total Instruments" value={investments.length} />
        <StatCard icon="📈" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Matured" value={matured} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Portfolio" value={`${investments.length} items`} />
      </StatGrid>
      <Card title="Treasury Investments">
        <RBITable investments={investments} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
