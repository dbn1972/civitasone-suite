import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceDeposits } from "@/app/_data/loaders";
import { DepositsTable } from "./DepositsTable";

export default async function DepositsPage() {
  const { data: deposits, source } = await getFinanceDeposits();
  const active = deposits.filter((d) => String(d.status).toLowerCase() === "active").length;
  const matured = deposits.filter((d) => String(d.status).toLowerCase() === "matured").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fixed Deposits"
        subtitle="Fixed and term deposits across treasury banks with maturity tracking."
        back="/finance"
      />
      <StatGrid>
        <StatCard icon="🏧" iconBg="#e7edfd" label="Total Deposits" value={deposits.length} />
        <StatCard icon="📈" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Matured" value={matured} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Refunded" value={deposits.length - active - matured} />
      </StatGrid>
      {/* UX-012: the data-source badge now lives inside DepositsTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      <Card title="Deposits Register">
        <DepositsTable deposits={deposits} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
