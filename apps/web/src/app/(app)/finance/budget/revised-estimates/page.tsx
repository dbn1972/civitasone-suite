import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceRevisedEstimates } from "@/app/_data/loaders";
import { RevisedEstimatesTable } from "./RevisedEstimatesTable";

export default async function RevisedEstimatesPage() {
  const { data: estimates, source } = await getFinanceRevisedEstimates();
  const increased = estimates.filter((e) => Number(e.variancePct ?? 0) > 0).length;
  const decreased = estimates.filter((e) => Number(e.variancePct ?? 0) < 0).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Revised Estimates"
        subtitle="Budget Estimate vs Revised Estimate with variance analysis by head."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="📊" iconBg="#e7edfd" label="Total Heads" value={estimates.length} />
        <StatCard icon="📈" iconBg="#ecfdf3" label="Increased" value={increased} />
        <StatCard icon="📉" iconBg="#fce7ee" label="Decreased" value={decreased} />
        <StatCard icon="➖" iconBg="#fffaeb" label="No Change" value={estimates.length - increased - decreased} />
      </StatGrid>
      <Card title="BE vs RE Variance">
        <RevisedEstimatesTable estimates={estimates} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
