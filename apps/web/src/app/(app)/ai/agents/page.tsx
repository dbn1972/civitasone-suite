import Link from "next/link";
import { Card, PageHeader, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { getAiAgentRows } from "../_data";
import { AgentsTable } from "./AgentsTable";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getAiAgentRows();
  return (
    <>
      {/* GAP-AI-AGENTS-05: client-side back via PageHeader (no full reload),
          replacing the hand-built <a href>+lucide breadcrumb.
          GAP-AI-AGENTS-04: a visible, keyboard-reachable link to the governance
          page where agents are paused/resumed (the kill-switch lives there). */}
      <PageHeader
        title="AI — Agents"
        subtitle="Multi-agent workflows and orchestration."
        back="/ai"
        backLabel="AI & Copilot"
        actions={<Link className="btn" href="/ai/governance">Manage in Governance</Link>}
      />
      {/* GAP-AI-AGENTS-01: a failed fetch shows a retry state, not an empty
          "No agents defined" table that reads as "none exist". */}
      {source === "error" ? (
        <Card title="Agents">
          <RefreshErrorState error={toHumanError("load", { area: "agents" })} />
        </Card>
      ) : (
        <Card title="Agents">
          <AgentsTable agents={data} />
        </Card>
      )}
    </>
  );
}
