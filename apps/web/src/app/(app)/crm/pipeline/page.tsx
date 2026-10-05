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

  const errored = source === "error";

  const totalDeals = deals.length;
  const totalValue = deals.reduce((sum, d) => sum + BigInt(d.valueMinor || "0"), 0n);
  const avgLikelihood = totalDeals > 0
    ? Math.round(deals.reduce((s, d) => s + d.probability, 0) / totalDeals)
    : 0;
  const highValueDeals = deals.filter((d) => BigInt(d.valueMinor || "0") >= 1000000n).length;

  // GAP-CRM-PIPELINE-01: on a failed load the four StatCards used to print 0, ₹0.00 and
  // 0% — fabricating "an empty pipeline" as fact when the real cause is an outage. Show
  // "—" instead so a failure never reads as real zero figures (matching rti /
  // service-requests). The board itself (KanbanBoard) renders its own error state and
  // keeps any cached copy, so we don't blank it here.
  const dealsValue = errored ? "—" : totalDeals.toLocaleString("en-IN");
  const totalValueDisplay = errored ? "—" : formatMoney(totalValue);
  const likelihoodValue = errored ? "—" : `${avgLikelihood}%`;
  const highValueDisplay = errored ? "—" : highValueDeals.toLocaleString("en-IN");

  return (
    <>
      <PageHeader
        title="Engagement Pipeline"
        subtitle="Move engagements between stages to track procurement progress • पाइपलाइन"
        back="/crm"
        actions={
          <a className="btn primary" href="/crm/deals/new">+ New Engagement</a>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="▣" iconBg="#e0f2fe" label="Total Engagements" value={dealsValue} />
        <StatCard icon="◈" iconBg="#dcfce7" label="Engagement Value" value={totalValueDisplay} />
        <StatCard icon="◉" iconBg="#fef3c7" label="Avg Likelihood" value={likelihoodValue} />
        <StatCard icon="△" iconBg="#fce7f3" label="High-Value Engagements" value={highValueDisplay} />
      </StatGrid>
      <KanbanBoard
        pipeline={pipeline}
        deals={deals}
        source={source as "api" | "error"}
      />
    </>
  );
}
