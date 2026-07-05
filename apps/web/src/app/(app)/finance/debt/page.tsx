import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceDebt } from "@/app/_data/loaders";
import { DebtTable } from "./DebtTable";

export default async function DebtPage() {
  const { data: loans, source } = await getFinanceDebt();
  const active = loans.filter((l) => String(l.status).toLowerCase() === "active").length;
  const closedCount = loans.filter((l) => String(l.status).toLowerCase() === "closed").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Debt Management"
        subtitle="Loans, EMI schedules, and lender-wise outstanding debt."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="🏦" iconBg="#e7edfd" label="Total Loans" value={loans.length} />
        <StatCard icon="📈" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Closed" value={closedCount} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Lenders" value={new Set(loans.map((l) => String(l.lender ?? ""))).size} />
      </StatGrid>
      <Card title="Loan Portfolio">
        <DebtTable loans={loans} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
