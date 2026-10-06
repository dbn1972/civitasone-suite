import { getProjectRisks } from "../../../../_data/loaders";
import { PageHeader, Card, EmptyState, StatGrid, StatCard, RefreshErrorState, StatusPill } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { humanizeStatus } from "@/lib/formatters";
import { getSessionRoles, hasAnyRole, PROJECT_WRITE_ROLES } from "@/lib/auth/roleGuard";
import { scoreBand, riskScoreVariant, riskStatusVariant, RISK_SCORE_LEGEND } from "./riskBands";
import { AddRiskForm } from "./AddRiskForm";

export default async function ProjectRisksPage({ params }: { params: { id: string } }) {
  const { data: risks, source } = await getProjectRisks(params.id);
  const errored = source === "error";

  // GAP-PROJECTS-DETAIL-RISKS-01: only project managers/officers (project-service
  // PROJ_ROLES) may add a risk; the server 403s others and audits via f3-consumer.
  const canManage = hasAnyRole(getSessionRoles(), PROJECT_WRITE_ROLES);

  const open      = errored ? 0 : risks.filter((r) => r.status === "open").length;
  const critical  = errored ? 0 : risks.filter((r) => scoreBand(r.riskScore) === "critical").length;
  const mitigated = errored ? 0 : risks.filter((r) => r.status === "mitigated").length;

  return (
    <>
      <PageHeader
        title="Risk Register"
        subtitle="Project risks, mitigation plans, and status tracking."
        back={`/projects/${params.id}`}
      />
      {canManage && !errored && (
        <Card title="Add Risk" padding>
          <AddRiskForm projectId={params.id} />
        </Card>
      )}
      <StatGrid>
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Open"      value={errored ? "—" : open} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Critical"  value={errored ? "—" : critical} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Mitigated" value={errored ? "—" : mitigated} />
        <StatCard icon="📋" iconBg="#eef0fe" label="Total"     value={errored ? "—" : risks.length} />
      </StatGrid>
      <Card title="Risks">
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "project risks" })} backHref={`/projects/${params.id}`} />
        ) : risks.length === 0 ? (
          <EmptyState
            icon="✅"
            title="No risks registered"
            message={canManage ? "No risks identified yet. Use the Add Risk form above to record the first one." : "No risks have been identified for this project."}
          />
        ) : (
          <>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    {["Risk", "Category", "Score", "Probability", "Impact", "Status", "Mitigation"].map((c) => (
                      <th key={c} scope="col">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {risks.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600, maxWidth: 200 }}>{r.title}</td>
                      <td style={{ color: "var(--ink2)", fontSize: "0.85rem" }}>
                        {r.category}
                      </td>
                      <td>
                        <StatusPill status={String(r.riskScore)} label={String(r.riskScore)} variant={riskScoreVariant(r.riskScore)} />
                      </td>
                      <td style={{ color: "var(--ink2)", fontSize: "0.85rem", textTransform: "capitalize" }}>
                        {r.probability}
                      </td>
                      <td style={{ color: "var(--ink2)", fontSize: "0.85rem", textTransform: "capitalize" }}>
                        {r.impact}
                      </td>
                      <td>
                        {/* GAP-PROJECTS-DETAIL-RISKS-03/04: shared StatusPill with a
                            domain tone override — "open" is red here (unresolved) but
                            stays green app-wide. Label is humanized, not raw lowercase. */}
                        <StatusPill status={r.status} label={humanizeStatus(r.status)} variant={riskStatusVariant(r.status)} />
                      </td>
                      <td style={{ color: "var(--ink2)", fontSize: "0.82rem", maxWidth: 220 }}>
                        {r.mitigationPlan ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* GAP-PROJECTS-DETAIL-RISKS-02: legend so the score bands are legible. */}
            <p style={{ marginTop: 10, fontSize: "0.8rem", color: "var(--ink2)" }}>{RISK_SCORE_LEGEND}</p>
          </>
        )}
      </Card>
    </>
  );
}
