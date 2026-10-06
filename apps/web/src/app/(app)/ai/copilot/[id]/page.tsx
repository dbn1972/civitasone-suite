import { notFound } from "next/navigation";
import { Card, EmptyState, PageHeader, RefreshErrorState, StatCard, StatGrid } from "../../../../_components/ds";
import { getCopilotTurn } from "../../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { safeHttpUrl } from "@/lib/safeUrl";
import { turnState } from "../copilot";
import { AutoRefresh } from "../AutoRefresh";
import { MaskablePromptText } from "../MaskablePromptText";

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
  const { data: turn, source, status } = await getCopilotTurn(params.id);

  // GAP-AI-COPILOT-DETAIL-01: an outage used to be shown as "Turn not found —
  // does not exist, or belongs to another tenant", conflating a 404 with a
  // service failure. Distinguish them: a real 404 (or a successful fetch with
  // no turn) is "not found"; any other error is a retryable load failure.
  const notFoundCase = status === 404 || (source === "api" && !turn);
  if (notFoundCase) {
    notFound();
  }

  if (source === "error" || !turn) {
    return (
      <>
        <PageHeader title="Copilot Turn" back="/ai/copilot" backLabel="Back to copilot" />
        <Card>
          <RefreshErrorState
            error={toHumanError("load", { area: "copilot turn" })}
            source={{ ...(typeof status === "number" ? { status } : {}), area: "copilot turn" }}
            backHref="/ai/copilot"
          />
        </Card>
      </>
    );
  }

  const answered = turnState(turn) === "answered";

  return (
    <>
      {/* GAP-AI-COPILOT-DETAIL-04: an awaiting turn used to tell the user to
          reload manually. Poll until the answer arrives, then stop. */}
      <AutoRefresh active={!answered} />
      <PageHeader
        title="Copilot Turn"
        subtitle={`Asked ${formatDateTime(turn.createdAt)}`}
        back="/ai/copilot"
        backLabel="Back to copilot"
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
        {/* GAP-AI-COPILOT-DETAIL-03: mask detected identifiers by default. */}
        <MaskablePromptText text={turn.prompt} label="prompt" />
      </Card>

      <Card title="Response">
        {answered ? (
          <MaskablePromptText text={turn.response ?? ""} label="response" />
        ) : (
          <EmptyState
            icon="⏳"
            title="Waiting for the answer"
            message="The prompt has been accepted and is being processed. This page updates automatically — no need to reload."
          />
        )}
      </Card>

      <Card title="Sources">
        {!answered ? (
          // GAP-AI-COPILOT-DETAIL-04: do not claim "answered without citing
          // documents" before the answer exists.
          <EmptyState
            icon="🔗"
            title="Sources appear once the answer is ready"
            message="Any documents the copilot cites will be listed here when the answer arrives."
          />
        ) : turn.sourceCitations.length === 0 ? (
          <EmptyState
            icon="🔗"
            title="No sources cited"
            message="This turn was answered without citing retrieved documents."
          />
        ) : (
          <ul style={{ padding: "12px 16px 12px 36px", margin: 0, fontSize: 14 }}>
            {turn.sourceCitations.map((citation, index) => {
              // GAP-AI-COPILOT-DETAIL-02: only render a live link for an
              // http(s) URL; anything else (javascript:/data:/relative) shows
              // as plain text.
              const href = safeHttpUrl(citation.url);
              const title = citation.title || citation.id || "Untitled source";
              return (
                <li key={citation.id || `citation-${index}`} style={{ marginBottom: 6 }}>
                  {href ? (
                    <a href={href} rel="noreferrer noopener" target="_blank">{citation.title || href}</a>
                  ) : (
                    <span>{title}</span>
                  )}
                  {typeof citation.score === "number" && (
                    // GAP-AI-COPILOT-DETAIL-05: show a readable percentage, with
                    // the raw score as a tooltip.
                    <span
                      style={{ color: "var(--muted, #64748b)", marginLeft: 8, fontSize: 12 }}
                      title={`Relevance score ${citation.score.toFixed(2)}`}
                    >
                      {Math.round(citation.score * 100)}% match
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
