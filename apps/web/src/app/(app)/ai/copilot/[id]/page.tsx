import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { Card, EmptyState, PageHeader, StatCard, StatGrid } from "../../../../_components/ds";
import { getCopilotTurn } from "../../../../_data/loaders";
import { turnState } from "../copilot";

interface PageProps {
  params: { id: string };
}

function formatDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function CopilotTurnPage({ params }: PageProps) {
  const { data: turn, source } = await getCopilotTurn(params.id);

  if (!turn) {
    return (
      <>
        <PageHeader title="Copilot Turn" back="/ai/copilot" />
        {source === "error" && <DataSourceBadge source={source} />}
        <Card>
          <EmptyState
            icon="💬"
            title="Turn not found"
            message="This copilot turn does not exist, or it belongs to another tenant."
            action={<a className="btn" href="/ai/copilot">Back to copilot</a>}
          />
        </Card>
      </>
    );
  }

  const answered = turnState(turn) === "answered";

  return (
    <>
      <PageHeader
        title="Copilot Turn"
        subtitle={`Asked ${formatDateTime(turn.createdAt)}`}
        back="/ai/copilot"
      />
      <StatGrid>
        <StatCard icon={answered ? "✅" : "⏳"} iconBg={answered ? "#dcfce7" : "#fef3c7"} label="State" value={answered ? "Answered" : "Awaiting"} />
        <StatCard icon="🤖" iconBg="#e0f2fe" label="Model" value={turn.model ?? "—"} />
        <StatCard
          icon="⚡"
          iconBg="#fce7f3"
          label="Latency"
          value={turn.latencyMs === null ? "—" : `${turn.latencyMs.toLocaleString("en-IN")} ms${turn.latencyBucket ? ` (${turn.latencyBucket})` : ""}`}
        />
        <StatCard
          icon="🔢"
          iconBg="#fef3c7"
          label="Tokens"
          value={turn.tokens === null ? "—" : turn.tokens.toLocaleString("en-IN")}
        />
      </StatGrid>

      <Card title="Prompt">
        <p style={{ padding: "12px 16px", margin: 0, whiteSpace: "pre-wrap", fontSize: 14 }}>{turn.prompt}</p>
      </Card>

      <Card title="Response">
        {answered ? (
          <p style={{ padding: "12px 16px", margin: 0, whiteSpace: "pre-wrap", fontSize: 14 }}>{turn.response}</p>
        ) : (
          <EmptyState
            icon="⏳"
            title="Answer not ready"
            message="The prompt has been accepted and is being processed. Reload this page in a moment to see the answer."
          />
        )}
      </Card>

      <Card title="Sources">
        {turn.sourceCitations.length === 0 ? (
          <EmptyState
            icon="🔗"
            title="No sources cited"
            message="This turn was answered without citing retrieved documents."
          />
        ) : (
          <ul style={{ padding: "12px 16px 12px 36px", margin: 0, fontSize: 14 }}>
            {turn.sourceCitations.map((citation, index) => (
              <li key={citation.id || `citation-${index}`} style={{ marginBottom: 6 }}>
                {citation.url
                  ? <a href={citation.url} rel="noreferrer noopener" target="_blank">{citation.title || citation.url}</a>
                  : (citation.title || citation.id || "Untitled source")}
                {typeof citation.score === "number" && (
                  <span style={{ color: "#64748b", marginLeft: 8, fontSize: 12 }}>
                    relevance {citation.score.toFixed(2)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
