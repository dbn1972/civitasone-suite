import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { EmptyState, PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getAiAgentStatuses, getAiGovernanceAudit, getAiGovernanceCounters } from "../_data";
import { AgentKillSwitch } from "./AgentKillSwitch";
import { AuditTrailTable } from "./AuditTrailTable";
import { blockRateBand, topBlockReasons } from "./governance";

export const dynamic = "force-dynamic";

const BAND_LABEL = {
  normal: "Within normal range",
  elevated: "Elevated — review the block reasons",
  critical: "Critical — the model is refusing a large share of requests",
} as const;

const BAND_COLOUR = { normal: "#047857", elevated: "#92400e", critical: "#b42318" } as const;

export default async function Page({ searchParams }: { searchParams?: { blocked?: string } }) {
  const blockedOnly = searchParams?.blocked === "true";

  const [counters, audit, agents] = await Promise.all([
    getAiGovernanceCounters(),
    getAiGovernanceAudit(blockedOnly ? { blocked: true } : undefined),
    getAiAgentStatuses(),
  ]);

  const source = counters.source === "error" || audit.source === "error" ? "error" : "api";
  const blockRatePct = counters.data?.blockRatePct ?? 0;
  const band = blockRateBand(blockRatePct);
  const reasons = topBlockReasons(audit.data);

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="AI Governance"
        subtitle="Model monitoring, the audit trail of every AI action, and the agent kill-switch."
        back="/ai"
        backLabel="AI & Copilot"
      />
      {source === "error" && <DataSourceBadge source={source} />}

      <StatGrid>
        <StatCard
          icon="🤖"
          iconBg="#eef2ff"
          label="AI Invocations"
          value={(counters.data?.totalInvocations ?? 0).toLocaleString("en-IN")}
        />
        <StatCard
          icon="🛑"
          iconBg="#fef2f2"
          label="Blocked Actions"
          value={(counters.data?.blockedCount ?? 0).toLocaleString("en-IN")}
        />
        <StatCard icon="📉" iconBg="#eef2ff" label="Block Rate" value={`${blockRatePct}%`} />
        <StatCard
          icon="⚡"
          iconBg="#eef2ff"
          label="Active Agents"
          value={(counters.data?.activeAgents ?? 0).toLocaleString("en-IN")}
        />
      </StatGrid>

      <p role="status" aria-live="polite" style={{ fontSize: 13, color: BAND_COLOUR[band], margin: "12px 0 0" }}>
        {BAND_LABEL[band]}
      </p>

      <div className="grid g-main" style={{ alignItems: "start", marginTop: 18 }}>
        <AuditTrailTable entries={audit.data} blockedOnly={blockedOnly} />

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Top Block Reasons</h3></div>
            {reasons.length === 0 ? (
              <EmptyState icon="✅" title="Nothing blocked" message="No AI action in this window was refused by a guardrail." />
            ) : (
              <div className="pad">
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {reasons.map((r) => (
                    <li key={r.reason} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
                      <span>{r.reason}</span>
                      <span style={{ fontWeight: 600 }}>{r.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <AgentKillSwitch agents={agents.data} />
        </div>
      </div>
    </main>
  );
}
