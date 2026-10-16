import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { getAssistantMetrics } from "../_data/loaders";
import { AssistantClient } from "./AssistantClient";

// GAP-KNOWLEDGE-ASSISTANT-02: when source==="error", stat cards now show "—"
// instead of misleading zeros. The RefreshErrorState is shown above the stats
// but the AssistantClient remains usable (it fetches independently).
export default async function Page() {
  const { data: metrics, source } = await getAssistantMetrics();
  const errored = source === "error";

  return (
    <>
      <PageHeader
        title="Virtual Assistant"
        subtitle="Ask the grounded assistant — answers cite source documents and published SOPs. Escalate to a support ticket if unresolved."
        back="/knowledge"
      />
      {errored && <DataSourceBadge source={source} />}
      {errored && <RefreshErrorState error={toHumanError("load", { area: "assistant metrics" })} />}
      <StatGrid>
        <StatCard icon="💬" tone="info" label="Questions asked" value={errored ? "—" : metrics.total.toLocaleString("en-IN")} />
        <StatCard icon="✅" tone="good" label="Deflected" value={errored ? "—" : metrics.deflected.toLocaleString("en-IN")} />
        <StatCard icon="🎯" tone="info" label="Deflection rate" value={errored ? "—" : `${metrics.deflectionRate}%`} />
        <StatCard icon="🆘" tone="bad" label="Escalated" value={errored ? "—" : metrics.escalated.toLocaleString("en-IN")} />
      </StatGrid>
      <AssistantClient />
    </>
  );
}
