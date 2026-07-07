import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getPipelines, getPipelineDeals } from "../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { KanbanBoard } from "./_components/KanbanBoard";

export default async function PipelinePage() {
  const [{ data: pipelines, source: pipelineSource }, { data: deals, source: dealsSource }] =
    await Promise.all([getPipelines(), getPipelineDeals()]);

  const source = pipelineSource === "error" || dealsSource === "error" ? "error" : "api";
  const pipeline = pipelines.length > 0 ? pipelines[0] : null;

  const totalDeals = deals.length;
  const totalValue = deals.reduce((sum, d) => sum + BigInt(d.valueMinor || "0"), 0n);
  const avgProbability = totalDeals > 0
    ? Math.round(deals.reduce((s, d) => s + d.probability, 0) / totalDeals)
    : 0;
  const highValueDeals = deals.filter((d) => BigInt(d.valueMinor || "0") >= 1000000n).length;

  return (
    <>
      <PageHeader
        title="Deal Pipeline"
        subtitle="Drag deals between stages to update their status."
        back="/crm"
        actions={
          <a className="btn primary" href="/crm/deals/new">+ New Deal</a>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="📊" iconBg="#e0f2fe" label="Total Deals" value={totalDeals.toLocaleString("en-IN")} />
        <StatCard icon="💰" iconBg="#dcfce7" label="Pipeline Value" value={formatMoney(totalValue)} />
        <StatCard icon="🎯" iconBg="#fef3c7" label="Avg Probability" value={`${avgProbability}%`} />
        <StatCard icon="⭐" iconBg="#fce7f3" label="High-Value Deals" value={highValueDeals.toLocaleString("en-IN")} />
      </StatGrid>
      <KanbanBoard
        pipeline={pipeline}
        deals={deals}
        source={source as "api" | "error"}
      />
    </>
  );
}
