import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getAssistantMetrics } from "../_data/loaders";
import { AssistantClient } from "./AssistantClient";

export default async function Page() {
  const { data: metrics, source } = await getAssistantMetrics();

  return (
    <>
      <PageHeader
        title="Virtual Assistant"
        subtitle="Ask the grounded assistant — answers cite source documents and published SOPs. Escalate to a support ticket if unresolved."
        back="/knowledge"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="💬" iconBg="#eef2ff" label="Questions asked" value={metrics.total.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Deflected" value={metrics.deflected.toLocaleString("en-IN")} />
        <StatCard icon="🎯" iconBg="#f0f9ff" label="Deflection rate" value={`${metrics.deflectionRate}%`} />
        <StatCard icon="🆘" iconBg="#fef2f2" label="Escalated" value={metrics.escalated.toLocaleString("en-IN")} />
      </StatGrid>
      <AssistantClient />
    </>
  );
}
