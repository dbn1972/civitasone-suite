import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceSchemes } from "@/app/_data/loaders";
import { SchemeTable } from "./SchemeTable";

export default async function SchemeTrackingPage() {
  const { data: schemes, source } = await getFinanceSchemes();
  const active = schemes.filter((s) => String(s.status).toLowerCase() === "active").length;
  const completed = schemes.filter((s) => String(s.status).toLowerCase() === "completed").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Scheme Tracking"
        subtitle="Scheme expenditure with milestones, UC status, and progress."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="🎯" iconBg="#e7edfd" label="Total Schemes" value={schemes.length} />
        <StatCard icon="📈" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Completed" value={completed} />
        <StatCard icon="⏳" iconBg="#eff6ff" label="Pending UC" value={schemes.length - active - completed} />
      </StatGrid>
      <Card title="Scheme Expenditure">
        <SchemeTable schemes={schemes} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
