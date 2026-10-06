import { Card, PageHeader, RefreshErrorState, StatCard, StatGrid } from "../../../_components/ds";
import { COPILOT_TURNS_LIMIT, getCopilotTurns } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { AskCopilotForm } from "./AskCopilotForm";
import { AutoRefresh } from "./AutoRefresh";
import { summariseTurns } from "./copilot";
import { TurnHistoryTable } from "./TurnHistoryTable";

export const dynamic = "force-dynamic";

export default async function CopilotPage() {
  const { data, source } = await getCopilotTurns();
  const errored = source === "error";
  const { turns, total } = data;
  const summary = summariseTurns(turns);
  // GAP-AI-COPILOT-04: prefer the server's real total; the per-page summary
  // only ever counts the latest page.
  const totalLabel = total !== null ? total.toLocaleString("en-IN") : summary.total.toLocaleString("en-IN");
  const atCap = turns.length >= COPILOT_TURNS_LIMIT;

  return (
    <>
      {/* GAP-AI-COPILOT-03: poll while any turn is still awaiting an answer. */}
      <AutoRefresh active={!errored && summary.awaiting > 0} />
      <PageHeader
        title="Copilot"
        subtitle="Ask a question in context. Every turn is recorded with its sources and latency."
        back="/ai"
        actions={<a className="btn" href="/ai/governance">Governance</a>}
      />
      {/* GAP-AI-COPILOT-01: a failed fetch used to read as an empty history
          (0 counts + "no turns yet") behind a small badge. On error the stat
          cards show "—" (StatCard maps null to "—") and the history card shows
          a real retry state instead of the misleading empty state. The Ask
          form stays rendered so the user can still submit. */}
      <StatGrid>
        <StatCard icon="💬" iconBg="#e0f2fe" label="Turns" value={errored ? null : totalLabel} />
        <StatCard icon="✅" iconBg="#dcfce7" label="Answered (latest page)" value={errored ? null : summary.answered.toLocaleString("en-IN")} />
        <StatCard icon="⏳" iconBg="#fef3c7" label="Awaiting (latest page)" value={errored ? null : summary.awaiting.toLocaleString("en-IN")} />
        <StatCard
          icon="⚡"
          iconBg="#fce7f3"
          label="Avg Latency"
          value={errored || summary.averageLatencyMs <= 0 ? null : `${summary.averageLatencyMs.toLocaleString("en-IN")} ms`}
        />
      </StatGrid>

      <AskCopilotForm />

      <Card title="Turn History">
        {errored ? (
          <RefreshErrorState
            error={toHumanError("load", { area: "copilot history" })}
            source={{ area: "copilot history" }}
          />
        ) : (
          <>
            {atCap ? (
              <p style={{ fontSize: 12, color: "var(--muted, #64748b)", padding: "10px 16px 0", margin: 0 }}>
                {`Showing the latest ${COPILOT_TURNS_LIMIT.toLocaleString("en-IN")} turns${
                  total !== null && total > turns.length ? ` of ${total.toLocaleString("en-IN")}` : ""
                }.`}
              </p>
            ) : null}
            <TurnHistoryTable turns={turns} />
          </>
        )}
      </Card>
    </>
  );
}
