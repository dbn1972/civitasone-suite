import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceDebt } from "@/app/_data/loaders";
import { DebtTable } from "./DebtTable";

export default async function DebtPage() {
  const { data: loans, source } = await getFinanceDebt();
  const active = loans.filter((l) => String(l.status).toLowerCase() === "active").length;
  const closedCount = loans.filter((l) => String(l.status).toLowerCase() === "closed").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Debt Management"
        subtitle="Loans, EMI schedules, and lender-wise outstanding debt."
        back="/finance"
      />
      <StatGrid>
        <StatCard icon="🏦" iconBg="#e7edfd" label="Total Loans" value={loans.length} />
        <StatCard icon="📈" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Closed" value={closedCount} />
        {/* treasury.finance_debt has no "lender" column — "source" (RBI|market|central_govt) is the closest real field. */}
        <StatCard icon="💰" iconBg="#eff6ff" label="Sources" value={new Set(loans.map((l) => l.source)).size} />
      </StatGrid>
      {/* UX-012: the data-source badge now lives inside DebtTable, driven by
          the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      <Card title="Loan Portfolio">
        <DebtTable loans={loans} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
