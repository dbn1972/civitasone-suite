import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceDeposits } from "@/app/_data/loaders";
import { DepositsTable } from "./DepositsTable";

export default async function DepositsPage() {
  const { data: deposits, source } = await getFinanceDeposits();
  const active = deposits.filter((d) => String(d.status).toLowerCase() === "active").length;
  const matured = deposits.filter((d) => String(d.status).toLowerCase() === "matured").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fixed Deposits"
        subtitle="Fixed and term deposits across treasury banks with maturity tracking."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="🏧" iconBg="#e7edfd" label="Total Deposits" value={deposits.length} />
        <StatCard icon="📈" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Matured" value={matured} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Refunded" value={deposits.length - active - matured} />
      </StatGrid>
      <Card title="Deposits Register">
        <DepositsTable deposits={deposits} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
