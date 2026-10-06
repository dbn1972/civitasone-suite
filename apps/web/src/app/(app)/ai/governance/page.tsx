import { EmptyState, PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { getAiAgentStatuses, getAiGovernanceAudit, getAiGovernanceCounters } from "../_data";
import { getSessionRoles, hasAnyRole, AI_AGENT_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { AgentKillSwitch } from "./AgentKillSwitch";
import { AuditTrailTable } from "./AuditTrailTable";
import { blockRateBand, topBlockReasons } from "./governance";

export const dynamic = "force-dynamic";

const BAND_LABEL = {
  normal: "Within normal range",
  elevated: "Elevated — review the block reasons",
  critical: "Critical — the model is refusing a large share of requests",
} as const;

// GAP-AI-GOVERNANCE-07: colour + icon by meaning, via DS status tokens that
// adapt in dark mode, with a non-colour (icon) cue alongside the text.
const BAND_PRESENTATION = {
  normal: { className: "pill good", icon: "✓" },
  elevated: { className: "pill warn", icon: "!" },
  critical: { className: "pill bad", icon: "⛔" },
} as const;

export default async function Page({ searchParams }: { searchParams?: { blocked?: string } }) {
  const blockedOnly = searchParams?.blocked === "true";

  const [counters, audit, agents] = await Promise.all([
    getAiGovernanceCounters(),
    getAiGovernanceAudit(blockedOnly ? { blocked: true } : undefined),
    getAiAgentStatuses(),
  ]);

  // GAP-AI-GOVERNANCE-01: track each source separately so one failure never
  // paints a false "all healthy" picture across the whole safety screen.
  const countersErrored = counters.source === "error";
  const auditErrored = audit.source === "error";
  const agentsErrored = agents.source === "error";

  // GAP-AI-GOVERNANCE-05: only AI admins may operate the kill-switch.
  const canManage = hasAnyRole(getSessionRoles(), AI_AGENT_ADMIN_ROLES);

  const haveCounters = !countersErrored && counters.data !== null;
  const blockRatePct = counters.data?.blockRatePct ?? 0;
  const band = blockRateBand(blockRatePct);
  const reasons = topBlockReasons(audit.data);

  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="AI Governance"
        subtitle="Model monitoring, the audit trail of every AI action, and the agent kill-switch."
        back="/ai"
        backLabel="AI & Copilot"
      />

      {/* GAP-AI-GOVERNANCE-01: on a counters failure show "—" (never a
          fabricated 0) and hide the band entirely. */}
      <StatGrid>
        <StatCard
          icon="🤖"
          iconBg="#eef2ff"
          label="AI Invocations"
          value={haveCounters ? counters.data!.totalInvocations.toLocaleString("en-IN") : null}
        />
        <StatCard
          icon="🛑"
          iconBg="#fef2f2"
          label="Blocked Actions"
          value={haveCounters ? counters.data!.blockedCount.toLocaleString("en-IN") : null}
        />
        <StatCard icon="📉" iconBg="#eef2ff" label="Block Rate" value={haveCounters ? `${blockRatePct}%` : null} />
        <StatCard
          icon="⚡"
          iconBg="#eef2ff"
          label="Active Agents"
          value={haveCounters ? counters.data!.activeAgents.toLocaleString("en-IN") : null}
        />
      </StatGrid>

      {haveCounters ? (
        <p role="status" aria-live="polite" style={{ margin: "12px 0 0" }}>
          <span className={BAND_PRESENTATION[band].className}>
            <span aria-hidden="true" style={{ marginRight: 6 }}>{BAND_PRESENTATION[band].icon}</span>
            {BAND_LABEL[band]}
          </span>
        </p>
      ) : null}

      <div className="grid g-main" style={{ alignItems: "start", marginTop: 18 }}>
        <AuditTrailTable
          entries={audit.data}
          blockedOnly={blockedOnly}
          agents={agents.data}
          errored={auditErrored}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Top Block Reasons</h3></div>
            {auditErrored ? (
              <RefreshErrorState error={toHumanError("load", { area: "block reasons" })} source={{ area: "block reasons" }} />
            ) : reasons.length === 0 ? (
              <EmptyState icon="✅" title="Nothing blocked" message="No AI action in the latest 100 audit entries was refused by a guardrail." />
            ) : (
              <div className="pad">
                {/* GAP-AI-GOVERNANCE-03: label the scope — these reasons are
                    computed from the latest 100 audit rows, not the counters. */}
                <p style={{ fontSize: 12, color: "var(--muted, #667085)", margin: "0 0 10px" }}>
                  From the latest 100 audit entries.
                </p>
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

          <AgentKillSwitch agents={agents.data} errored={agentsErrored} canManage={canManage} />
        </div>
      </div>
    </div>
  );
}
