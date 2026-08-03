import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Card, PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCopilotTurns } from "../../../_data/loaders";
import { AskCopilotForm } from "./AskCopilotForm";
import { summariseTurns } from "./copilot";
import { TurnHistoryTable } from "./TurnHistoryTable";

export const dynamic = "force-dynamic";

export default async function CopilotPage() {
  const { data: turns, source } = await getCopilotTurns();
  const summary = summariseTurns(turns);

  return (
    <>
      <PageHeader
        title="Copilot"
        subtitle="Ask a question in context. Every turn is recorded with its sources and latency."
        back="/ai"
        actions={<a className="btn" href="/ai/governance">Governance</a>}
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="💬" iconBg="#e0f2fe" label="Turns" value={summary.total.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#dcfce7" label="Answered" value={summary.answered.toLocaleString("en-IN")} />
        <StatCard icon="⏳" iconBg="#fef3c7" label="Awaiting" value={summary.awaiting.toLocaleString("en-IN")} />
        <StatCard
          icon="⚡"
          iconBg="#fce7f3"
          label="Avg Latency"
          value={summary.averageLatencyMs > 0 ? `${summary.averageLatencyMs.toLocaleString("en-IN")} ms` : "—"}
        />
      </StatGrid>

      <AskCopilotForm />

      <Card title="Turn History">
        <TurnHistoryTable turns={turns} />
      </Card>
    </>
  );
}
