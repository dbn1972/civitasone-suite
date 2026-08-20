import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceOutcomeBudget } from "@/app/_data/loaders";
import { OutcomeBudgetTable } from "./OutcomeBudgetTable";

export default async function OutcomeBudgetPage() {
  const { data: outcomes, source } = await getFinanceOutcomeBudget();
  // achievementBps is basis points (10000 = 100%), not a 0-100 percent.
  const achievementPct = (o: (typeof outcomes)[number]) => Number(o.achievementBps ?? 0) / 100;
  const achieved = outcomes.filter((o) => achievementPct(o) >= 100).length;
  const inProgress = outcomes.filter((o) => { const p = achievementPct(o); return p > 0 && p < 100; }).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Outcome Budget"
        subtitle="Scheme output indicators and achievement tracking."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="🎯" iconBg="#e7edfd" label="Total Indicators" value={outcomes.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Achieved" value={achieved} />
        <StatCard icon="📈" iconBg="#fffaeb" label="In Progress" value={inProgress} />
        <StatCard icon="⏳" iconBg="#eff6ff" label="Not Started" value={outcomes.length - achieved - inProgress} />
      </StatGrid>
      <Card title="Outcome Indicators">
        <OutcomeBudgetTable outcomes={outcomes} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
